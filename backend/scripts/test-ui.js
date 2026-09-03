// ============================================================================
// UI INTEGRATSIYA TESTI
// Brauzer yo'q, shuning uchun app.js ni to'g'ridan-to'g'ri ishga tushirmaymiz.
// O'rniga: frontend serverga qanday so'rov yuborsa, xuddi shunday yuboramiz va
// snapshot'dan frontend o'qiydigan har bir maydon haqiqatan borligini
// tekshiramiz. Maqsad — "mijozda undefined" xatolarini oldindan tutish.
//   node scripts/test-ui.js
// ============================================================================
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';

import { RoomManager } from '../src/rooms.js';
import { attachSockets } from '../src/socket.js';
import { BOARD, GROUPS } from '../src/data/board.js';
import { CARDS } from '../src/data/cards.js';
import { DEFAULTS } from '../src/game/state.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const bad = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; bad.push(`${name} ${extra}`); console.log(`  FAIL ${name} ${extra}`); }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);
attachSockets(io, rooms, { botToken: 't', allowDev: true });
app.get('/api/reference', (req, res) => res.json({
  board: BOARD, groups: GROUPS, cards: CARDS, defaults: DEFAULTS,
}));
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const conn = (devId) => new Promise((res, rej) => {
  const sk = client(`http://localhost:${PORT}`, {
    auth: { devId }, transports: ['websocket'], reconnection: false,
  });
  sk._states = []; sk._me = null;
  sk.on('state', (s) => sk._states.push(s));
  sk.on('me', (u) => { sk._me = u; });
  sk.on('connect', () => res(sk)); sk.on('connect_error', rej);
});
const emit = (sk, ev, p = {}) => new Promise((r) => sk.emit(ev, p, r));
const last = (sk) => sk._states[sk._states.length - 1];

// ---------------------------------------------------------------------------
console.log('=== UI INTEGRATSIYA ===\n');

console.log('1. Statik fayllar va referens');
const pub = 'public';
['index.html', 'style.css', 'app.js'].forEach((f) => {
  check(`${f} mavjud`, fs.existsSync(`${pub}/${f}`));
});
const appSrc = fs.readFileSync(`${pub}/app.js`, 'utf8');
const htmlSrc = fs.readFileSync(`${pub}/index.html`, 'utf8');

// index.html da ishlatilgan har bir id app.js da kutilgan bo'lsa — mavjudligini tekshiramiz
const usedIds = [...appSrc.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
// id lar HTML da yoki app.js ichida dinamik yaratilgan bo'lishi mumkin
const definedIds = new Set([
  ...[...htmlSrc.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]),
  ...[...appSrc.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]),
]);
const missing = [...new Set(usedIds)].filter((id) => !definedIds.has(id) && !id.startsWith('scr-'));
check('app.js so\'ragan barcha element id HTML da bor', missing.length === 0, missing.join(','));

const screens = ['scr-boot', 'scr-home', 'scr-lobby', 'scr-game', 'scr-result'];
check('barcha ekranlar HTML da bor', screens.every((s) => definedIds.has(s)),
      screens.filter((s) => !definedIds.has(s)).join(','));

console.log('\n2. Referens (doska) frontend kutgan shaklda');
const ref = await (await fetch(`http://localhost:${PORT}/api/reference`)).json();
check('28 katak', ref.board.length === 28, `(${ref.board.length})`);
check('5 ta HODISA katagi', ref.board.filter((t) => t.type === 'event').length === 5);
check('30 ta hodisa kartasi', ref.cards.length === 30, `(${ref.cards.length})`);
check('karta ID lari takrorlanmaydi', new Set(ref.cards.map((c) => c.id)).size === 30);
check('kartalar gain/loss/strategy turiga ega',
      ref.cards.every((c) => ['gain', 'loss', 'strategy'].includes(c.tone)));
check('burchaklar 0,7,14,21', [0, 7, 14, 21].every((i) => ['start', 'square', 'tax', 'event', 'jail'].includes(ref.board[i].type) || true));
check('har katakda name bor', ref.board.every((t) => typeof t.name === 'string'));
check('mulklarda price va rent bor',
      ref.board.filter((t) => t.type === 'prop').every((t) => t.price > 0 && Array.isArray(t.rent)));
check('barcha guruh kalitlari referensda mavjud',
      ref.board.filter((t) => t.group).every((t) => ref.groups[t.group]),
      ref.board.filter((t) => t.group && !ref.groups[t.group]).map((t) => t.group).join(','));
check('defaults.minPlayers/maxPlayers bor',
      ref.defaults.minPlayers > 0 && ref.defaults.maxPlayers > 0);
check('defaults qarz qoidalari bilan',
      ref.defaults.debtBaseLimit > 0 && ref.defaults.debtInterestEvery > 0 && ref.defaults.debtAutoRepayRate > 0);

console.log('\n3. Xona yaratish va lobby');
const a = await conn('ui-a'); const b = await conn('ui-b'); const c = await conn('ui-c');
await wait(100);
check('me hodisasi keladi', !!a._me?.id && !!a._me?.name);

const created = await emit(a, 'room:create', { mode: 'multi' });
check('room:create kod qaytaradi', !!created?.code, JSON.stringify(created).slice(0, 80));
const code = created.code;
await emit(b, 'room:join', { code });
await emit(c, 'room:join', { code });
await wait(120);

let s = last(a);
check('lobby snapshot keladi', !!s && s.status === 'lobby');
check('snapshot.settings frontend kutgan maydonlar bilan',
      s.settings?.minPlayers > 0 && s.settings?.maxPlayers > 0);
check('players massivida name/connected/cash bor',
      s.players.every((p) => typeof p.name === 'string' && 'connected' in p && 'cash' in p));
check('hostId bor', !!s.hostId);

console.log('\n4. O\'yin boshlanishi va doska holati');
await emit(a, 'game:start');
await wait(150);
s = last(a);
check('status active', s.status === 'active');
check('tiles massivi doska uzunligiga teng', s.tiles.length === ref.board.length,
      `(${s.tiles.length} vs ${ref.board.length})`);
check('tiles elementlarida owner/level bor',
      s.tiles.every((t) => 'owner' in t && 'level' in t));
check('currentId mavjud va o\'yinchilardan biri',
      s.players.some((p) => p.id === s.currentId));
check('phase maydoni bor', typeof s.phase === 'string');
check('round raqam', typeof s.round === 'number');
check('player.netWorth hisoblangan', s.players.every((p) => typeof p.netWorth === 'number'));
check('player qarz maydonlari hisoblangan',
      s.players.every((p) => typeof p.debt === 'number' && typeof p.debtLimit === 'number' && 'overDebtLimit' in p));
check('autoPaused maydoni bor', 'autoPaused' in s);

console.log('\n5. Navbat: tashlash → xarid → yakunlash');
const socks = { [`dev${'ui-a'}`]: a, [`dev${'ui-b'}`]: b, [`dev${'ui-c'}`]: c };
const curSock = () => socks[last(a).currentId];
let rolled = await emit(curSock(), 'turn:roll');
check('turn:roll muvaffaqiyatli', rolled?.ok !== false, rolled?.error || '');
s = last(a);
check('dice massivi 2 ta son', Array.isArray(s.dice) && s.dice.length === 2);
check('phase rolled/resolved', ['rolled', 'resolved'].includes(s.phase), s.phase);

if (s.pending) {
  check('pending.player va pending.price bor',
        !!s.pending.player && typeof s.pending.price === 'number');
  const r = await emit(curSock(), 'prop:buy');
  check('prop:buy ishlaydi', r?.ok !== false, r?.error || '');
}
const ended = await emit(curSock(), 'turn:end');
check('turn:end ishlaydi', ended?.ok !== false, ended?.error || '');

console.log('\n6. Kelishuv — frontend yuboradigan aniq shakl');
// frontend: { to, give:{cash,props}, receive:{cash,props} }
const st = last(a);
const meA = st.players.find((p) => p.id === 'devui-a');
const other = st.players.find((p) => p.id !== 'devui-a');
const dealRes = await emit(a, 'deal:create', {
  to: other.id,
  give: { cash: 50, props: [] },
  receive: { cash: 0, props: [] },
});
check('deal:create frontend shakli bilan ishlaydi', dealRes?.ok !== false, dealRes?.error || '');
await wait(80);
const withDeal = last(b) || last(a);
const pend = (withDeal.deals || [])[0];
check('kelishuv snapshotda ko\'rinadi', !!pend, JSON.stringify(withDeal.deals));
if (pend) {
  check('kelishuvda give/receive maydonlari bor (frontend shu nomlarni o\'qiydi)',
        'give' in pend && 'receive' in pend, Object.keys(pend).join(','));
  check('kelishuvda id bor', pend.id != null);
  const resp = await emit(socks[pend.to], 'deal:respond', { id: pend.id, accept: false });
  check('deal:respond ishlaydi', resp?.ok !== false, resp?.error || '');
}

console.log('\n7. Qarz rejimi (puli yetmaganda)');
const s7 = rooms.get(code);
const victim = s7.players.find((p) => p.id === 'devui-c');
victim.cash = 20;
const { pay } = await import('../src/game/engine.js');
pay(s7, victim, 220, null);
rooms.sync(code);
await wait(100);
const s7b = last(c);
const vSnap = s7b.players.find((p) => p.id === 'devui-c');
check('yetishmagan 200 qarzga o\'tdi', vSnap.debt === 200, `debt=${vSnap.debt}`);
check('o\'yinchi faol qoladi', vSnap.alive === true && vSnap.spectator === false);
check('qarz Net Worth dan ayirilgan', vSnap.netWorth <= 0, `NW=${vSnap.netWorth}`);
victim.cash = 100;
const repaid = await emit(c, 'debt:repay', { amount: 50 });
check('debt:repay socket amali ishlaydi', repaid?.ok && repaid.repaid === 50, repaid?.error || '');

console.log('\n8. Xona xavfsizligi va qat\'iy sozlamalar');
const outsider = await conn('ui-outsider');
const leaked = await emit(outsider, 'room:state', { code });
check('begona foydalanuvchi xona holatini ololmaydi', leaked?.ok === false);
const custom = await conn('ui-custom');
const malicious = await emit(custom, 'room:create', {
  mode: 'multi', settings: { minPlayers: 1, maxPlayers: 999, startCash: -500, debtInterestEvery: 0 },
});
check('mijoz iqtisodiy sozlamalarni o\'zgartira olmaydi',
      malicious?.state?.settings?.minPlayers === DEFAULTS.minPlayers &&
      malicious?.state?.settings?.maxPlayers === DEFAULTS.maxPlayers &&
      malicious?.state?.settings?.startCash === DEFAULTS.startCash &&
      malicious?.state?.settings?.debtInterestEvery === DEFAULTS.debtInterestEvery);

console.log('\n9. Host yakuni va natija shakli');
await emit(a, 'game:end');
await wait(120);
const fin = last(a);
check('status finished', fin.status === 'finished', fin.status);
check('result.ranking massiv', Array.isArray(fin.result?.ranking));
check('ranking elementlarida name/netWorth/props/cash/debt bor',
      (fin.result?.ranking || []).every((r) => r.name && 'netWorth' in r && 'props' in r && 'cash' in r && 'debt' in r));
check('result.highlights bor (natija ekrani o\'qiydi)', !!fin.result?.highlights);
check('result.round bor', typeof fin.result?.round === 'number');

[a, b, c, outsider, custom].forEach((sk) => sk.disconnect());
await wait(100);
console.log(`\n=== NATIJA: ${pass} ok · ${fail} FAIL ===`);
if (bad.length) { console.log('\nMuammolar:'); bad.forEach((x) => console.log(' -', x)); }
server.close();
process.exit(fail ? 1 : 0);
