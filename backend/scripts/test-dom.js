// ============================================================================
// DOM TESTI — app.js ni haqiqiy DOM (jsdom) ichida, haqiqiy serverga ulangan
// holda ishga tushiradi. Maqsad: brauzerda chiqadigan runtime xatolarni
// (undefined o'qish, yo'q element, noto'g'ri render) shu yerda tutish.
//   node scripts/test-dom.js
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { JSDOM, VirtualConsole } from 'jsdom';

import { RoomManager } from '../src/rooms.js';
import { attachSockets } from '../src/socket.js';
import { BOARD, GROUPS } from '../src/data/board.js';
import { DEFAULTS } from '../src/game/state.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const bad = [];
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; bad.push(`${n} ${e}`); console.log(`  FAIL ${n} ${e}`); }
};

// ---------------- server ----------------
const app = express();
app.use(express.static('public'));
app.get('/api/reference', (req, res) =>
  res.json({ board: BOARD, groups: GROUPS, defaults: DEFAULTS }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);
attachSockets(io, rooms, { botToken: 't', allowDev: true });
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const ORIGIN = `http://localhost:${PORT}`;

// ---------------- brauzer ----------------
const jsErrors = [];
function makeBrowser(devId) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => jsErrors.push(`[${devId}] ${e.message}`));
  vc.on('error', (...a) => jsErrors.push(`[${devId}] ${a.join(' ')}`));

  // jsdom tashqi CDN (shrift, telegram SDK) ni yuklay olmaydi va bizga
  // ular kerak emas — HTML dan olib tashlaymiz. app.js va socket.io ni
  // qo'lda inject qilamiz, shunda yuklanish tartibi aniq bo'ladi.
  const html = fs.readFileSync('public/index.html', 'utf8')
    .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '')
    .replace(/<link[^>]*fonts\.gstatic[^>]*>/g, '')
    .replace(/<script[^>]*telegram-web-app[^>]*><\/script>/g, '')
    .replace(/<script[^>]*socket\.io\.js[^>]*><\/script>/g, '')
    .replace(/<script[^>]*\/app\.js[^>]*><\/script>/g, '');

  const dom = new JSDOM(html, {
    url: ORIGIN,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  // Telegram yo'q — dev rejim: devId ni oldindan qo'yamiz
  w.localStorage.setItem('devId', devId);
  w.fetch = (...a) => fetch(new URL(a[0], ORIGIN), a[1]);
  w.addEventListener('error', (e) => jsErrors.push(`[${devId}] ${e.message}`));
  w.addEventListener('unhandledrejection', (e) => jsErrors.push(`[${devId}] rejection ${e.reason}`));
  return { dom, w };
}

async function loadScripts(w, files) {
  for (const f of files) {
    const code = fs.readFileSync(path.join('public', f), 'utf8');
    const s = w.document.createElement('script');
    s.textContent = code;
    w.document.body.appendChild(s);
    await wait(50);
  }
}

console.log('=== DOM TESTI ===\n1. Ilova yuklanishi');

// socket.io client skriptini avval yuklaymiz
const ioClient = fs.readFileSync('node_modules/socket.io-client/dist/socket.io.min.js', 'utf8');

const A = makeBrowser('dom-a');
const sA = A.w.document.createElement('script');
sA.textContent = ioClient;
A.w.document.body.appendChild(sA);
await wait(100);
check('socket.io mijozi yuklandi', typeof A.w.io === 'function');

await loadScripts(A.w, ['app.js']);
await wait(900);

const $A = (id) => A.w.document.getElementById(id);
check('boshlang\'ich ekran almashdi (boot → home)',
      $A('scr-home').classList.contains('on'), 'boot hali ko\'rinmoqda');
check('foydalanuvchi ismi ko\'rsatildi', ($A('homeName').textContent || '').length > 0);
check('gerb chizildi', $A('homeCrest').innerHTML.includes('<svg'));
check('yuklashda JS xatosi yo\'q', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

console.log('\n2. Xona yaratish (UI tugmasi orqali)');
$A('btnCreate').dispatchEvent(new A.w.Event('click'));
await wait(600);
check('lobby ekraniga o\'tdi', $A('scr-lobby').classList.contains('on'));
const code = ($A('lobbyCode').textContent || '').trim();
check('xona kodi ko\'rsatildi', /^[A-Z0-9]{4,6}$/.test(code), code);
check('o\'yinchilar ro\'yxati chizildi', $A('lobbyPlayers').children.length === 1);
check('BOSHLASH tugmasi o\'chirilgan (3 kishi yo\'q)', $A('btnStart').disabled === true);

console.log('\n3. Yana ikki o\'yinchi qo\'shiladi');
const B = makeBrowser('dom-b');
const C = makeBrowser('dom-c');
for (const X of [B, C]) {
  const s = X.w.document.createElement('script');
  s.textContent = ioClient;
  X.w.document.body.appendChild(s);
  await wait(80);
  await loadScripts(X.w, ['app.js']);
}
await wait(800);
for (const X of [B, C]) {
  if (!X.w.EV) { check('ikkinchi mijoz yuklandi', false, 'EV yo\'q'); break; }
  const inp = X.w.document.createElement('input');
  inp.id = 'joinCode'; inp.value = code;
  X.w.document.body.appendChild(inp);
  await X.w.EV.doJoin();
  await wait(250);
}
await wait(400);
check('lobbyda 3 o\'yinchi', $A('lobbyPlayers').children.length === 3,
      String($A('lobbyPlayers').children.length));
check('BOSHLASH endi faol', $A('btnStart').disabled === false);

console.log('\n4. O\'yin boshlanadi va doska chiziladi');
$A('btnStart').dispatchEvent(new A.w.Event('click'));
await wait(700);
check('o\'yin ekraniga o\'tdi', $A('scr-game').classList.contains('on'));
const board = $A('board');
check('doskada 28 katak + markaz', board.children.length === 29,
      String(board.children.length));
check('markaz paneli bor', !!board.querySelector('.center'));
check('kataklarda nom bor', board.querySelectorAll('.cell .nm').length === 28,
      String(board.querySelectorAll('.cell .nm').length));
check('kataklarda yagona SVG ikon tizimi bor', board.querySelectorAll('.cell .tile-svg').length === 28,
      String(board.querySelectorAll('.cell .tile-svg').length));
check('doskada 5 ta binafsha HODISA katagi bor', board.querySelectorAll('.cell.type-event').length === 5,
      String(board.querySelectorAll('.cell.type-event').length));
check('HODISA kataklarida KARTA belgisi bor', board.querySelectorAll('.cell.type-event .event-label').length === 5,
      String(board.querySelectorAll('.cell.type-event .event-label').length));
check('mulk guruhlari rangli rels bilan ajratilgan', board.querySelectorAll('.cell .group-band').length === 19,
      String(board.querySelectorAll('.cell .group-band').length));
check('doskaning to\'rt tomoni semantik ajratilgan',
      ['top', 'right', 'bottom', 'left'].every((side) => board.querySelector(`.cell.side-${side}`)));
check('kataklar klaviatura uchun tugma va izohga ega',
      [...board.querySelectorAll('.cell')].every((c) => c.tagName === 'BUTTON' && c.getAttribute('aria-label')));
check('o\'yinchi tokenlari chizildi', board.querySelectorAll('.tok').length >= 3,
      String(board.querySelectorAll('.tok').length));
check('naqd pul ko\'rsatildi', ($A('meCash').textContent || '') !== '0');
check('pip lar chizildi', $A('pips').children.length === 3);

console.log('\n5. Navbat: kubik tashlash');
const browsers = { 'devdom-a': A, 'devdom-b': B, 'devdom-c': C };
const roomState = () => rooms.get(code);
// xom holatda currentId yo'q — u snapshotda hisoblanadi
const curId = () => { const st = roomState(); return st.order[st.turnIndex]; };
const curBrowser = () => browsers[curId()];
const X = curBrowser();
if (!X) {
  check('navbatdagi o\'yinchi brauzeri topildi', false,
        `currentId=${curId()} mavjud=${Object.keys(browsers).join(',')}`);
}
const $X = (id) => X.w.document.getElementById(id);
const rollBtn = X ? $X('board').querySelector('.roll-btn') : null;
check('navbatdagi o\'yinchida TASHLASH tugmasi bor', !!rollBtn);
if (rollBtn) {
  rollBtn.dispatchEvent(new X.w.Event('click'));
  await wait(500);
  check('kubik natijasi ko\'rindi', $X('board').querySelectorAll('.die').length >= 1);
  check('server holati yangilandi', roomState().phase !== 'idle', roomState().phase);
}

console.log('\n6. Panellar ochiladi');
const panels = ['assets', 'deal', 'economy', 'log'];
for (const p of panels) {
  const btn = A.w.document.querySelector(`.dock button[data-panel="${p}"]`);
  btn.dispatchEvent(new A.w.Event('click'));
  await wait(180);
  check(`"${p}" paneli ochildi`, $A('sheet').hidden === false && $A('sheetBody').innerHTML.length > 30);
  A.w.EV.close();
  await wait(80);
}

console.log('\n6b. Kelishuvni UI orqali rad etish');
const { createDeal } = await import('../src/game/deals.js');
const uiDeal = createDeal(roomState(), 'devdom-a', {
  to: 'devdom-b', give: { cash: 10, props: [] }, receive: { cash: 0, props: [] },
});
rooms.sync(code);
await wait(250);
const dealBtnB = B.w.document.querySelector('.dock button[data-panel="deal"]');
dealBtnB.dispatchEvent(new B.w.Event('click'));
await wait(150);
const rejectBtn = B.w.document.querySelector('#sheetBody .row2 .btn:not(.primary)');
check('kelgan taklif tugmalari chizildi', uiDeal.ok && !!rejectBtn);
if (rejectBtn) rejectBtn.dispatchEvent(new B.w.Event('click'));
await wait(250);
check('string deal ID bilan RAD ishlaydi',
      roomState().deals.find((d) => d.id === uiDeal.deal.id)?.status === 'rejected');

console.log('\n7. Katakni bosish — mulk kartasi');
const cell = board.querySelector('.cell');
cell.dispatchEvent(new A.w.Event('click'));
await wait(200);
check('mulk kartasi ochildi', $A('sheet').hidden === false);
A.w.EV.close();

console.log('\n8. Menyu va qoidalar');
$A('btnMenu').dispatchEvent(new A.w.Event('click'));
await wait(180);
check('menyu ochildi', $A('sheetBody').innerHTML.includes('Menyu'));
A.w.EV.rules();
await wait(180);
check('qoidalar ochildi va vaqt chegarasi yo\'qligini aytadi',
      $A('sheetBody').textContent.includes('Vaqt va raund chegarasi') &&
      $A('sheetBody').textContent.includes('Qarz va kredit'));
A.w.EV.close();

console.log('\n9. Qarz rejimi');
const { pay } = await import('../src/game/engine.js');
const st = roomState();
const victimId = 'devdom-c';
const victim = st.players.find((p) => p.id === victimId);
victim.cash = 0;
pay(st, victim, 900, null);
rooms.sync(code);
await wait(400);
const $C = (id) => C.w.document.getElementById(id);
check('qarz HUD da ko\'rinadi', ($C('meDebt').textContent || '') !== '0');
check('limit oshganda banner ko\'rinadi',
      ($C('banner').textContent || '').includes('Qarz limiti'), $C('banner').textContent);
$C('btnDebt').dispatchEvent(new C.w.Event('click'));
await wait(160);
check('moliya paneli ochiladi', ($C('sheetBody').textContent || '').includes('Moliya'));
C.w.EV.close();
check('qarzdor o\'yinchi doskada qoladi', $C('board').querySelectorAll('.cell').length === 28 && victim.alive);

console.log('\n10. O\'yin tugashi va natija ekrani');
A.w.EV.confirmEndGame();
await wait(500);
check('natija ekraniga o\'tdi', $A('scr-result').classList.contains('on'));
check('reyting chizildi', $A('resultList').children.length === 3,
      String($A('resultList').children.length));
check('g\'olib ajratilgan', !!$A('resultList').querySelector('.res-row.win'));
check('natijada qarz ko\'rsatilgan', ($A('resultList').textContent || '').includes('qarz'));
check('statistika ko\'rsatildi', ($A('resultStats').textContent || '').length > 0);

console.log('\n11. Umumiy JS xatolari');
check('butun seans davomida JS xatosi yo\'q', jsErrors.length === 0,
      jsErrors.slice(0, 3).join(' | '));

console.log(`\n=== NATIJA: ${pass} ok · ${fail} FAIL ===`);
if (bad.length) { console.log('\nMuammolar:'); bad.forEach((x) => console.log(' -', x)); }
server.close();
process.exit(fail ? 1 : 0);
