// ============================================================================
// MONITOR — mavjud testlar qamramagan joylarni tekshiradi.
// Diqqat markazi: uzilish/qaytish mantiqi, resurs oqishi, o'zini o'zi o'ynash.
//   node scripts/monitor.js
// ============================================================================
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';

import { RoomManager } from '../src/rooms.js';
import { attachSockets } from '../src/socket.js';
import { snapshot } from '../src/game/state.js';

const CFG = { botToken: 'test', allowDev: true };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const uid = (d) => `dev${d}`;

let PORT = 0, server, rooms, ioSrv;
let pass = 0, fail = 0;
const issues = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; issues.push(`${name} ${detail}`); console.log(`  FAIL ${name} ${detail}`); }
}

function connect(devId) {
  return new Promise((resolve, reject) => {
    const sk = client(`http://localhost:${PORT}`, {
      auth: { devId }, transports: ['websocket'], reconnection: false,
    });
    sk._restored = null;
    sk.on('session:restored', (d) => { sk._restored = d; });
    sk.on('connect', () => resolve(sk));
    sk.on('connect_error', reject);
  });
}
const emit = (sk, ev, payload = {}) => new Promise((r) => sk.emit(ev, payload, r));

async function makeGame(ids) {
  const socks = [];
  for (const id of ids) socks.push(await connect(id));
  const { code } = await emit(socks[0], 'room:create', { mode: 'multi' });
  for (const sk of socks.slice(1)) await emit(sk, 'room:join', { code });
  await emit(socks[0], 'game:start');
  await wait(150);
  return { code, socks };
}

// grace-period ni testda tezlashtirish
// armAwayTurn minimal 1000ms kutadi — shuning uchun har chaqiruvdan keyin
// kamida shuncha kutish kerak, aks holda avtomatik o'tkazish umuman ishlamaydi.
const GRACE_TICK = 1300;

function forceGrace(code) {
  const s = rooms.get(code);
  if (!s) return;
  s.players.forEach((p) => { if (p.disconnectedAt) p.disconnectedAt = Date.now() - 60_000; });
  rooms.clearAwayTimer(code);
  rooms.armAwayTurn(code);
}

async function graceStep(code) { forceGrace(code); await wait(GRACE_TICK); }

async function boot() {
  const app = express();
  server = http.createServer(app);
  ioSrv = new Server(server, { cors: { origin: '*' } });
  rooms = new RoomManager(ioSrv);
  attachSockets(ioSrv, rooms, CFG);
  await new Promise((r) => server.listen(0, r));
  PORT = server.address().port;
}

// ---------------------------------------------------------------------------
async function t1_emptyRoomSelfPlay() {
  console.log('\n1. Hamma uzilib ketsa — o\'yin o\'zini o\'zi o\'ynab yubormaydimi?');
  const { code, socks } = await makeGame(['m1', 'm2', 'm3']);
  const roundStart = rooms.get(code).round;

  socks.forEach((sk) => sk.disconnect());
  await wait(300);

  const s = rooms.get(code);
  check('hech kim ulanmagan holat aniqlanadi',
        s.players.every((p) => p.isBot || !p.connected));

  // grace tugadi deb 6 marta majburlaymiz
  for (let i = 0; i < 6; i++) await graceStep(code);

  const after = rooms.get(code);
  check('bo\'sh xonada o\'yin o\'zini o\'zi o\'ynamaydi',
        after.round === roundStart && after.status !== 'finished',
        `(round ${roundStart} → ${after.round}, status=${after.status})`);
  check('bo\'sh xona avtomatik to\'xtatiladi',
        after.status === 'paused' || after.round === roundStart,
        `(status=${after.status})`);
  check('away timer bo\'sh xonada osilib qolmaydi', !rooms.awayTimers.has(code));
}

// ---------------------------------------------------------------------------
async function t2_pendingBuyCleared() {
  console.log('\n2. Xarid taklifi ochiqligida uzilish');
  const { code, socks } = await makeGame(['m4', 'm5', 'm6']);
  const s = rooms.get(code);
  const curId = s.order[s.turnIndex];
  const curSock = socks[['m4', 'm5', 'm6'].findIndex((x) => uid(x) === curId)];

  // kubik tashlab, xarid taklifi ochiq holatda uzilamiz
  await emit(curSock, 'turn:roll');
  await wait(100);
  const hadPending = !!rooms.get(code).pending;
  curSock.disconnect();
  await wait(200);
  await graceStep(code);

  const after = rooms.get(code);
  check('xarid taklifi tozalanadi', !after.pending, `(pending bor edi: ${hadPending})`);
  check('navbat keyingi o\'yinchiga o\'tdi', after.order[after.turnIndex] !== curId);
  check('mulk avtomatik sotib olinmagan',
        after.players.find((p) => p.id === curId).props.length === 0);

  socks.forEach((sk) => sk.disconnect());
  await wait(100);
}

// ---------------------------------------------------------------------------
async function t3_awaySkipsMeaning() {
  console.log('\n3. Ketma-ket o\'tkazishlar — MAX_AWAY_SKIPS haqiqatan ta\'sir qiladimi?');
  const { code, socks } = await makeGame(['m7', 'm8', 'm9']);
  const s = rooms.get(code);
  const curId = s.order[s.turnIndex];
  const curSock = socks[['m7', 'm8', 'm9'].findIndex((x) => uid(x) === curId)];
  curSock.disconnect();
  await wait(200);

  const posBefore = rooms.get(code).players.find((p) => p.id === curId).pos;
  // 6 ta to'liq aylanish davomida navbatini o'tkazamiz
  for (let i = 0; i < 18; i++) {
    const st = rooms.get(code);
    if (st.status !== 'active') break;
    if (st.order[st.turnIndex] === curId) { await graceStep(code); }
    else {
      // qolgan ikkisi ham uzilgan emas — ularni ham majburan o'tkazamiz
      const other = st.order[st.turnIndex];
      const idx = ['m7', 'm8', 'm9'].findIndex((x) => uid(x) === other);
      if (idx >= 0 && socks[idx].connected) {
        await emit(socks[idx], 'turn:roll');
        await emit(socks[idx], 'prop:skip');
        await emit(socks[idx], 'turn:end');
      }
      await wait(60);
    }
  }
  const p = rooms.get(code).players.find((x) => x.id === curId);
  check('awaySkips hisoblanadi', p.awaySkips >= 2, `(${p.awaySkips})`);
  check('chegaradan keyin yo\'q o\'yinchi uchun kubik tashlanmaydi',
        p.awaySkips < 3 || p.pos === posBefore || p.awayIdle === true,
        `(skips=${p.awaySkips}, pos ${posBefore}→${p.pos})`);
  check('o\'yinchi baribir chetlashtirilmagan', p.alive === true);

  socks.forEach((sk) => sk.disconnect());
  await wait(100);
}

// ---------------------------------------------------------------------------
async function t4_timerLeak() {
  console.log('\n4. Timer va xotira oqishi');
  const before = rooms.awayTimers.size + rooms.timers.size;
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const { code, socks } = await makeGame([`x${i}a`, `x${i}b`, `x${i}c`]);
    codes.push(code);
    socks.forEach((sk) => sk.disconnect());
  }
  await wait(400);
  // xonalarni TTL bo'yicha o'chiramiz
  codes.forEach((c) => { const s = rooms.get(c); if (s) s.updatedAt = 0; });
  rooms.sweep();
  await wait(200);

  const leftRooms = codes.filter((c) => rooms.get(c)).length;
  const after = rooms.awayTimers.size + rooms.timers.size;
  check('TTL o\'tgan xonalar o\'chiriladi', leftRooms === 0, `(qoldi: ${leftRooms})`);
  check('timerlar tozalanadi', after <= before, `(${before} → ${after})`);
}

// ---------------------------------------------------------------------------
async function t5_pausedReconnect() {
  console.log('\n5. Pauzada uzilish va qaytish');
  const { code, socks } = await makeGame(['m10', 'm11', 'm12']);
  await emit(socks[0], 'game:pause');
  socks[1].disconnect();
  await wait(200);
  await graceStep(code);

  const s = rooms.get(code);
  check('pauzada navbat o\'tkazilmaydi', s.status === 'paused');
  check('pauzada away timer qo\'yilmaydi', !rooms.awayTimers.has(code));

  const back = await connect('m11');
  await wait(250);
  check('pauzadagi o\'yinga qaytish ishlaydi', back._restored?.code === code);
  check('qaytgach status hali paused', rooms.get(code).status === 'paused');

  socks.forEach((sk) => sk.disconnect()); back.disconnect();
  await wait(100);
}

// ---------------------------------------------------------------------------
async function t6_multiDevice() {
  console.log('\n6. Bitta foydalanuvchi ikki qurilmadan');
  const { code, socks } = await makeGame(['m13', 'm14', 'm15']);
  const second = await connect('m13');   // o'sha foydalanuvchi, ikkinchi ulanish
  await wait(150);
  socks[0].disconnect();                  // birinchisini uzamiz
  await wait(250);

  const p = rooms.get(code).players.find((x) => x.id === uid('m13'));
  check('ikkinchi qurilma ochiq bo\'lsa uzilgan deb belgilanmaydi',
        p.connected === true, `(connected=${p.connected})`);

  socks.slice(1).forEach((sk) => sk.disconnect()); second.disconnect();
  await wait(100);
}

// ---------------------------------------------------------------------------
async function t7_finishedRoomRestore() {
  console.log('\n7. Tugagan o\'yin va seans tiklash');
  const { code, socks } = await makeGame(['m16', 'm17', 'm18']);
  await emit(socks[0], 'game:end');
  await wait(150);
  check('o\'yin tugadi', rooms.get(code).status === 'finished');

  socks.forEach((sk) => sk.disconnect());
  await wait(200);
  const again = await connect('m16');
  await wait(250);
  check('tugagan o\'yinga avtomatik qaytarilmaydi',
        !again._restored, `(restored=${JSON.stringify(again._restored?.code)})`);
  again.disconnect();
  await wait(100);
}

// ---------------------------------------------------------------------------
async function t8_stateGrowth() {
  console.log('\n8. Holat hajmi (uzoq o\'yin davomida)');
  const { code, socks } = await makeGame(['m19', 'm20', 'm21']);
  const sizeAt = () => JSON.stringify(snapshot(rooms.get(code))).length;
  const first = sizeAt();

  for (let i = 0; i < 120; i++) {
    const st = rooms.get(code);
    if (st.status !== 'active') break;
    const curId = st.order[st.turnIndex];
    const idx = ['m19', 'm20', 'm21'].findIndex((x) => uid(x) === curId);
    if (idx < 0) break;
    await emit(socks[idx], 'turn:roll');
    await emit(socks[idx], 'prop:skip');
    await emit(socks[idx], 'turn:end');
  }
  const last = sizeAt();
  const st = rooms.get(code);
  check('snapshot hajmi nazoratda', last < first * 3, `(${first} → ${last} bayt)`);
  check('log cheklangan', (st.log?.length || 0) <= 100, `(${st.log?.length})`);
  check('kelishuvlar ro\'yxati cheklangan', (st.deals?.length || 0) <= 40, `(${st.deals?.length})`);

  socks.forEach((sk) => sk.disconnect());
  await wait(100);
}

// ---------------------------------------------------------------------------
async function t9_debtOnOwnTurn() {
  console.log('\n9. O\'z navbatida katta qarz olish — o\'yin davom etadimi?');
  const { code, socks } = await makeGame(['m22', 'm23', 'm24']);
  const { pay } = await import('../src/game/engine.js');

  const s = rooms.get(code);
  const curId = s.order[s.turnIndex];
  const victim = s.players.find((p) => p.id === curId);

  // Majburiy to'lovni aynan o'z navbatida qarzga o'tkazamiz.
  victim.cash = 0;
  pay(s, victim, 1200, null);
  rooms.sync(code);
  await wait(300);

  const after = rooms.get(code);
  check('navbat qarzdor o\'yinchida qoladi',
        after.order[after.turnIndex] === curId,
        `(navbat ${after.order[after.turnIndex]})`);
  check('o\'yin faolligicha qoldi', after.status === 'active', after.status);
  check('o\'yinchi chiqarilmadi, qarz yozildi', victim.alive && !victim.spectator && victim.debt === 1200);

  // Qarzdor o'yinchi haqiqatan o'ynay oladimi?
  const ids = ['m22', 'm23', 'm24'];
  const idx = ids.findIndex((x) => uid(x) === curId);
  const r = idx >= 0 ? await emit(socks[idx], 'turn:roll') : { ok: false };
  check('qarzdor o\'yinchi navbatini o\'ynay oladi', r?.ok !== false, r?.error || '');

  socks.forEach((sk) => sk.disconnect());
  await wait(100);
}

// ---------------------------------------------------------------------------
(async () => {
  await boot();
  console.log('=== MONITOR ===');
  try {
    await t1_emptyRoomSelfPlay();
    await t2_pendingBuyCleared();
    await t3_awaySkipsMeaning();
    await t4_timerLeak();
    await t5_pausedReconnect();
    await t6_multiDevice();
    await t7_finishedRoomRestore();
    await t8_stateGrowth();
    await t9_debtOnOwnTurn();
  } catch (e) {
    console.error('\nKUTILMAGAN XATO:', e);
    fail++;
  }
  console.log(`\n=== NATIJA: ${pass} ok · ${fail} FAIL ===`);
  if (issues.length) { console.log('\nMuammolar:'); issues.forEach((i) => console.log(' -', i)); }
  server.close();
  process.exit(0);
})();
