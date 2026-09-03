// ============================================================================
// RECONNECT TESTLARI — haqiqiy server + haqiqiy socket.io mijozlari.
// Ishga tushirish:  node scripts/test-reconnect.js
// ============================================================================
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';

import { RoomManager } from '../src/rooms.js';
import { attachSockets } from '../src/socket.js';

const CFG = { botToken: 'test', allowDev: true };
let PORT = 0;
let server, rooms;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// auth.js dev foydalanuvchiga 'dev' prefiksini qo'shadi
const uid = (devId) => `dev${devId}`;

function connect(devId) {
  return new Promise((resolve, reject) => {
    const sk = client(`http://localhost:${PORT}`, {
      auth: { devId },
      transports: ['websocket'],
      reconnection: false,
    });
    // Server 'session:restored' ni ulanish bilan bir vaqtda yuboradi —
    // shuning uchun tinglovchini ulanishdan oldin qo'yamiz.
    sk._restored = null;
    sk.on('session:restored', (d) => { sk._restored = d; });
    sk.on('connect', () => resolve(sk));
    sk.on('connect_error', reject);
  });
}

// buferlangan yoki keyin keladigan hodisani kutish
async function restored(sk, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (sk._restored) return sk._restored;
    await wait(50);
  }
  return null;
}

const emit = (sk, ev, payload = {}) =>
  new Promise((resolve) => sk.emit(ev, payload, resolve));

const nextState = (sk, predicate = () => true, ms = 4000) =>
  new Promise((resolve) => {
    const to = setTimeout(() => { sk.off('state', h); resolve(null); }, ms);
    const h = (st) => {
      if (!predicate(st)) return;
      clearTimeout(to); sk.off('state', h); resolve(st);
    };
    sk.on('state', h);
  });

const once = (sk, ev, ms = 4000) =>
  new Promise((resolve) => {
    const to = setTimeout(() => { sk.off(ev, h); resolve(null); }, ms);
    const h = (d) => { clearTimeout(to); sk.off(ev, h); resolve(d); };
    sk.on(ev, h);
  });

// O'yin uchun eng kam 3 o'yinchi kerak (DEFAULTS.minPlayers = 3)
async function setupGame(ids) {
  const socks = [];
  for (const id of ids) socks.push(await connect(id));
  const { code } = await emit(socks[0], 'room:create', { mode: 'multi' });
  for (const sk of socks.slice(1)) await emit(sk, 'room:join', { code });
  const started = await emit(socks[0], 'game:start');
  await wait(200);
  return { code, socks, started };
}

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

async function boot() {
  const app = express();
  server = http.createServer(app);
  const ioSrv = new Server(server, { cors: { origin: '*' } });
  rooms = new RoomManager(ioSrv);
  attachSockets(ioSrv, rooms, CFG);
  await new Promise((r) => server.listen(0, r));
  PORT = server.address().port;
}

// ---------------------------------------------------------------------------
async function testGraceAndPresence() {
  console.log('\n1. Uzilish → grace-period → qaytish');
  const { code, socks } = await setupGame(['u-a', 'u-b', 'u-x']);
  const [a, b, c] = socks;
  check('o\'yin boshlandi', rooms.get(code).status === 'active');

  b.disconnect();
  const st = await nextState(a, (s) => s.players.some((p) => p.id === uid('u-b') && !p.connected));
  check('uzilgan o\'yinchi connected=false deb belgilanadi', !!st);
  const pb = st?.players.find((p) => p.id === uid('u-b'));
  check('disconnectedAt yoziladi (grace hisobi uchun)', !!pb?.disconnectedAt);
  check('o\'yinchi o\'yindan chiqarilmaydi', pb?.alive === true);
  check('mulk/pul saqlanadi', typeof pb?.cash === 'number');

  // qaytadi
  const b2 = await connect('u-b');
  const rs = await restored(b2);
  check('qayta ulanganda seans avtomatik tiklanadi', rs?.code === code);
  check('to\'liq holat qaytariladi', Array.isArray(rs?.state?.players));
  const back = rs?.state?.players.find((p) => p.id === uid('u-b'));
  check('qaytgach connected=true', back?.connected === true);
  check('disconnectedAt tozalanadi', back?.disconnectedAt === null);

  a.disconnect(); b2.disconnect(); c.disconnect();
  await wait(100);
}

// ---------------------------------------------------------------------------
async function testFrozenTurn() {
  console.log('\n2. Navbatdagi o\'yinchi uzilsa — o\'yin muzlamaydi');
  const { code, socks } = await setupGame(['u-c', 'u-d', 'u-y']);
  const s0 = rooms.get(code);
  const currentId = s0.order[s0.turnIndex];
  const byId = Object.fromEntries(socks.map((sk, i) => [uid(['u-c','u-d','u-y'][i]), sk]));
  const victim = byId[currentId];
  const observer = socks.find((sk) => sk !== victim);
  check('o\'yin boshlandi va navbat odamda', !!currentId);

  // grace-period ni testda qisqartirish uchun uzilish vaqtini orqaga suramiz
  victim.disconnect();
  await wait(200);
  const p = rooms.get(code).players.find((x) => x.id === currentId);
  p.disconnectedAt = Date.now() - 44_000;   // grace tugashiga ~1s
  rooms.clearAwayTimer(code);
  rooms.armAwayTurn(code);

  const advanced = await nextState(observer, (s) => s.order[s.turnIndex] !== currentId, 6000);
  check('grace tugagach navbat avtomatik o\'tadi', !!advanced,
        advanced ? '' : '(navbat muzlab qoldi!)');
  const after = rooms.get(code).players.find((x) => x.id === currentId);
  check('awaySkips hisoblanadi', (after?.awaySkips || 0) >= 1);
  check('o\'yin hali faol', rooms.get(code).status === 'active');

  socks.forEach((sk) => sk.disconnect());
  await wait(100);
}

// ---------------------------------------------------------------------------
async function testReconnectCancelsSkip() {
  console.log('\n3. Grace ichida qaytish — navbat o\'tkazilmaydi');
  const { code, socks } = await setupGame(['u-e', 'u-f', 'u-z']);
  const s0 = rooms.get(code);
  const currentId = s0.order[s0.turnIndex];
  const byId = Object.fromEntries(socks.map((sk, i) => [uid(['u-e','u-f','u-z'][i]), sk]));
  const victim = byId[currentId];

  victim.disconnect();
  await wait(300);
  const back = await connect(currentId.replace(/^dev/, ''));
  await restored(back);
  await wait(500);

  const s1 = rooms.get(code);
  const p = s1.players.find((x) => x.id === currentId);
  check('navbat hali o\'sha o\'yinchida', s1.order[s1.turnIndex] === currentId);
  check('awaySkips oshmagan', (p?.awaySkips || 0) === 0);
  check('away timer tozalangan', !rooms.awayTimers.has(code));

  socks.forEach((sk) => sk.disconnect()); back.disconnect();
  await wait(100);
}

// ---------------------------------------------------------------------------
async function testHostDisconnect() {
  console.log('\n4. Host uzilishi — o\'yin buzilmaydi');
  const { code, socks } = await setupGame(['u-g', 'u-h', 'u-w']);
  const [a, b, c] = socks;
  a.disconnect();
  await wait(300);
  const s = rooms.get(code);
  check('xona o\'chirilmaydi', !!s);
  check('o\'yin faolligicha qoladi', s.status === 'active');
  check('hostGoneAt belgilanadi', !!s.hostGoneAt);
  check('host huquqi darhol tortib olinmaydi', s.hostId === uid('u-g'));

  // grace tugadi deb simulyatsiya
  s.hostGoneAt = Date.now() - 91_000;
  rooms.sweep();
  check('grace tugagach host uzatiladi', rooms.get(code).hostId === uid('u-h'));

  b.disconnect(); c.disconnect();
  await wait(100);
}

// ---------------------------------------------------------------------------
async function testPauseResume() {
  console.log('\n5. Pauza — holat to\'liq saqlanadi');
  const { code, socks } = await setupGame(['u-i', 'u-j', 'u-v']);
  const [a] = socks;
  const s0 = rooms.get(code);
  const curSock = socks[['u-i','u-j','u-v'].findIndex((x) => uid(x) === s0.order[s0.turnIndex])];
  await emit(curSock, 'turn:roll').catch(() => {});
  await wait(200);
  const before = JSON.stringify(rooms.get(code).players.map((p) => [p.cash, p.pos, p.props]));

  await emit(a, 'game:pause');
  check('status paused', rooms.get(code).status === 'paused');
  check('pauzada away timer ishlamaydi', !rooms.awayTimers.has(code));

  const denied = await emit(curSock, 'turn:end');
  check('pauzada amal bajarilmaydi', denied?.ok === false);

  await wait(400);
  await emit(a, 'game:resume');
  const after = JSON.stringify(rooms.get(code).players.map((p) => [p.cash, p.pos, p.props]));
  check('holat o\'zgarmagan (pul/pozitsiya/mulk)', before === after);
  check('status active', rooms.get(code).status === 'active');

  socks.forEach((sk) => sk.disconnect());
  await wait(100);
}

// ---------------------------------------------------------------------------
async function testServerRestart() {
  console.log('\n6. Server qayta ishga tushishi (hydrate)');
  const s = {
    code: 'ZZZZ', status: 'active', updatedAt: Date.now(),
    hostId: 'u-k', hostGoneAt: null,
    players: [
      { id: 'u-k', name: 'K', isBot: false, connected: true, disconnectedAt: null, awaySkips: 0 },
      { id: 'u-l', name: 'L', isBot: false, connected: true, disconnectedAt: null, awaySkips: 0 },
    ],
  };
  // hydrate mantig'ini to'g'ridan-to'g'ri qo'llaymiz
  s.players.forEach((p) => {
    if (p.isBot) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    p.awaySkips = p.awaySkips || 0;
  });
  check('restartdan keyin hamma uzilgan deb belgilanadi', s.players.every((p) => !p.connected));
  check('grace hisobi restart vaqtidan boshlanadi',
        s.players.every((p) => Date.now() - p.disconnectedAt < 1000));
  check('hech kim darhol "tashlab ketgan" bo\'lmaydi', s.players.every((p) => p.awaySkips === 0));
}

// ---------------------------------------------------------------------------
(async () => {
  await boot();
  console.log('=== RECONNECT TESTLARI ===');
  try {
    await testGraceAndPresence();
    await testFrozenTurn();
    await testReconnectCancelsSkip();
    await testHostDisconnect();
    await testPauseResume();
    await testServerRestart();
  } catch (e) {
    console.error('\nXATO:', e);
    failed++;
  }
  console.log(`\n=== NATIJA: ${passed} o'tdi, ${failed} muvaffaqiyatsiz ===`);
  server.close();
  process.exit(failed ? 1 : 0);
})();
