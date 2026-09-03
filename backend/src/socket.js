// ============================================================================
// SOCKET LAYER — mijoz faqat "niyat" yuboradi, natijani server hisoblaydi.
// ============================================================================
import { authenticate } from './lib/auth.js';
import { snapshot, playerById } from './game/state.js';
import * as E from './game/engine.js';
import { createDeal, respondDeal, cancelDeal } from './game/deals.js';

// Har turdagi so'rov alohida savatda cheklanadi. Ayniqsa xona yaratishni
// umumiy action limiteriga qo'yish yetarli emas — u disk/xotirani to'ldirishi mumkin.
function rateOk(socket, key = 'action', windowMs = 1000, max = 12) {
  const now = Date.now();
  const buckets = socket.data.rateBuckets ||= {};
  const b = buckets[key] ||= { start: now, hits: 0 };
  if (now - b.start > windowMs) { b.start = now; b.hits = 0; }
  b.hits += 1;
  return b.hits <= max;
}

export function attachSockets(io, rooms, cfg) {
  io.use((socket, next) => {
    const { initData, devId } = socket.handshake.auth || {};
    const user = authenticate({ initData, devId }, { botToken: cfg.botToken, allowDev: cfg.allowDev });
    if (!user) return next(new Error('AUTH_FAILED'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const reply = (cb, payload) => typeof cb === 'function' && cb(payload);

    socket.emit('me', user);

    // ---------------- seansni avtomatik tiklash ----------------
    // Mijoz sahifani yangilaganda yoki ilovani qayta ochganda xona kodini
    // bilmasligi mumkin — server uni o'zi topib, to'liq holatni qaytaradi.
    const active = rooms.roomsFor(user.id);
    if (active.length) {
      const s0 = active[0];
      socket.join(s0.code);
      socket.data.code = s0.code;
      rooms.setConnected(s0.code, user.id, true);
      socket.emit('session:restored', {
        code: s0.code,
        state: snapshot(s0),
        others: active.slice(1).map((r) => ({ code: r.code, status: r.status })),
      });
    }

    // ---------------- xona ----------------
    socket.on('room:create', ({ mode } = {}, cb) => {
      if (!rateOk(socket, 'room:create', 60_000, 4))
        return reply(cb, { ok: false, error: 'Juda ko\'p xona yaratildi' });
      if (rooms.roomsFor(user.id).length >= 3)
        return reply(cb, { ok: false, error: 'Avvalgi faol xonalardan chiqing' });
      // MVP qoidalari serverda qat'iy: mijoz minPlayers/startCash kabi
      // iqtisodiy sozlamalarni o'zgartira olmaydi.
      const safeMode = mode === 'tutorial' ? 'tutorial' : 'multi';
      const s = rooms.create(user, { mode: safeMode });
      socket.join(s.code);
      socket.data.code = s.code;
      reply(cb, { ok: true, code: s.code, state: snapshot(s) });
      rooms.sync(s.code);
    });

    socket.on('room:join', ({ code } = {}, cb) => {
      if (!rateOk(socket, 'room:join', 10_000, 20))
        return reply(cb, { ok: false, error: 'Juda tez-tez' });
      const res = rooms.join(code, user);
      if (res.error) return reply(cb, { ok: false, error: res.error });
      socket.join(res.state.code);
      socket.data.code = res.state.code;
      const p = playerById(res.state, user.id);
      if (p) p.connected = true;
      reply(cb, { ok: true, code: res.state.code, state: snapshot(res.state) });
      rooms.sync(res.state.code);
    });

    socket.on('room:leave', (_, cb) => {
      const code = socket.data.code;
      if (code) { rooms.leave(code, user.id); socket.leave(code); socket.data.code = null; }
      reply(cb, { ok: true });
    });

    socket.on('room:state', ({ code } = {}, cb) => {
      if (!rateOk(socket, 'room:state', 10_000, 30))
        return reply(cb, { ok: false, error: 'Juda tez-tez' });
      const s = rooms.get(code || socket.data.code);
      if (!s) return reply(cb, { ok: false, error: 'Xona topilmadi' });
      if (!playerById(s, user.id))
        return reply(cb, { ok: false, error: 'Siz bu xonada emassiz' });
      socket.join(s.code);
      socket.data.code = s.code;
      const p = playerById(s, user.id);
      if (p) p.connected = true;
      reply(cb, { ok: true, state: snapshot(s) });
      rooms.sync(s.code);
    });

    socket.on('room:reconnect', ({ code } = {}, cb) => {
      if (!rateOk(socket, 'room:state', 10_000, 30))
        return reply(cb, { ok: false, error: 'Juda tez-tez' });
      const s = rooms.get(code || socket.data.code);
      if (!s) return reply(cb, { ok: false, error: 'Xona topilmadi' });
      if (!playerById(s, user.id)) return reply(cb, { ok: false, error: 'Siz bu xonada emassiz' });
      socket.join(s.code);
      socket.data.code = s.code;
      rooms.setConnected(s.code, user.id, true);
      reply(cb, { ok: true, code: s.code, state: snapshot(s) });
    });

    // ---------------- host ----------------
    const hostAction = (fn) => (_, cb) => {
      try {
        if (!rateOk(socket, 'host', 5_000, 10))
          return reply(cb, { ok: false, error: 'Juda tez-tez' });
        const code = socket.data.code;
        const res = fn(code, user.id);
        reply(cb, res?.error ? { ok: false, error: res.error } : { ok: true });
      } catch (e) {
        console.error('[socket] host amali xatosi:', e.message);
        reply(cb, { ok: false, error: 'Ichki xato' });
      }
    };
    socket.on('game:start',  hostAction((c, u) => rooms.start(c, u)));
    socket.on('game:pause',  hostAction((c, u) => rooms.pause(c, u)));
    socket.on('game:resume', hostAction((c, u) => rooms.resume(c, u)));
    socket.on('game:end',    hostAction((c, u) => rooms.endGame(c, u)));
    socket.on('game:host', ({ to } = {}, cb) => {
      if (!rateOk(socket, 'host', 5_000, 10))
        return reply(cb, { ok: false, error: 'Juda tez-tez' });
      const res = rooms.transferHost(socket.data.code, user.id, to);
      reply(cb, res.error ? { ok: false, error: res.error } : { ok: true });
    });

    // ---------------- o'yin amallari ----------------
    const act = (name, fn) => socket.on(name, (payload = {}, cb) => {
      try {
        const s = rooms.get(socket.data.code);
        if (!s) return reply(cb, { ok: false, error: 'Xona topilmadi' });
        if (s.status === 'paused') return reply(cb, { ok: false, error: "O'yin to'xtatilgan" });
        if (!rateOk(socket, 'action', 1000, 12)) return reply(cb, { ok: false, error: 'Juda tez-tez' });
        const res = fn(s, payload);
        if (res?.ok) {
          E.checkFinish(s);
          rooms.sync(s.code);
          if (name.startsWith('deal')) rooms.botAnswerDeals(s.code);
        }
        reply(cb, res || { ok: true });
      } catch (e) {
        // Bitta noto'g'ri so'rov butun serverni qulatmasligi kerak
        console.error(`[socket] ${name} xatosi:`, e.message);
        reply(cb, { ok: false, error: 'Ichki xato' });
      }
    });

    act('turn:roll',    (s) => E.roll(s, user.id));
    act('turn:end',     (s) => E.endTurn(s, user.id));
    act('prop:buy',     (s) => E.buy(s, user.id));
    act('prop:skip',    (s) => E.skipBuy(s, user.id));
    act('prop:upgrade', (s, { tile }) => E.upgrade(s, user.id, Number(tile)));
    act('prop:downgrade', (s, { tile }) => E.sellUpgrade(s, user.id, Number(tile)));
    act('prop:sell',    (s, { tile }) => E.sellProperty(s, user.id, Number(tile)));
    act('debt:repay',   (s, { amount }) => E.repayDebt(s, user.id, amount));

    act('deal:create',  (s, payload) => createDeal(s, user.id, payload));
    act('deal:respond', (s, { id, accept }) => respondDeal(s, user.id, id, !!accept));
    act('deal:cancel',  (s, { id }) => cancelDeal(s, user.id, id));

    // ---------------- ulanish ----------------
    socket.on('disconnect', () => {
      const code = socket.data.code;
      if (!code) return;
      const others = [...(io.sockets.adapter.rooms.get(code) || [])]
        .map((sid) => io.sockets.sockets.get(sid))
        .filter((sk) => sk && sk.data.user?.id === user.id && sk.id !== socket.id);
      if (others.length) return;                 // boshqa qurilmadan ulangan
      // O'yinchi darhol chiqarilmaydi: rooms.setConnected grace-period boshlaydi,
      // shu vaqt ichida qaytsa hech narsa yo'qolmaydi.
      rooms.setConnected(code, user.id, false);
    });
  });
}
