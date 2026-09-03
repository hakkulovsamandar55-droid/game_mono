// ============================================================================
// ROOM MANAGER — xonalar, host huquqlari, pauza/davom, qayta ulanish, bot navbati.
// ============================================================================
import { createRoom, createPlayer, snapshot, playerById, current, log, DEFAULTS } from './game/state.js';
import { startGame, endTurn, finish, checkFinish, roll, skipBuy } from './game/engine.js';
import { botRoll, botDecideBuy, botBuild, botEnd, botMaybeDeal, botJudgeDeal } from './game/bot.js';
import { respondDeal } from './game/deals.js';
import { store } from './lib/store.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOST_GRACE_MS = 90_000;       // host qaytishi uchun vaqt
const PLAYER_GRACE_MS = 45_000;     // uzilgan o'yinchining navbatini kutish vaqti
const MAX_AWAY_SKIPS = 3;           // shundan keyin o'yinchi "tashlab ketgan" deb belgilanadi
const ROOM_TTL_MS = 12 * 3600_000;  // 12 soat

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.timers = new Map();
    this.awayTimers = new Map();   // bot navbati timerlaridan alohida saqlanadi
    setInterval(() => this.sweep(), 15_000).unref?.();
    // eski yozuvlar bazada cheksiz to'planib qolmasin
    setInterval(() => store.prune(ROOM_TTL_MS * 2), 3600_000).unref?.();
  }

  // ---------- yuklash / saqlash ----------
  hydrate() {
    store.all().forEach((s) => {
      if (!Array.isArray(s.cardDeck)) s.cardDeck = [];
      s.players.forEach((p) => {
        p.debt = Number.isFinite(p.debt) && p.debt > 0 ? Math.round(p.debt) : 0;
        p.stats ||= {};
        for (const key of ['borrowed', 'repaidDebt', 'debtInterest', 'peakDebt']) {
          if (!Number.isFinite(p.stats[key])) p.stats[key] = 0;
        }
        // Eski versiyada bankrot bo'lgan faol o'yinchilar yangi qarz
        // qoidasida yana navbat oladi. Yo'qolgan mulk avtomatik tiklanmaydi,
        // ammo ular matchdan chiqarilgan holatda qolib ketmaydi.
        if (s.status !== 'finished') { p.alive = true; p.spectator = false; }
        if (p.isBot) return;
        p.connected = false;
        // Server qayta ishga tushdi: grace-period shu paytdan boshlanadi,
        // aks holda eski timestamp tufayli hamma darhol "tashlab ketgan" bo'lardi.
        p.disconnectedAt = Date.now();
        p.awaySkips = p.awaySkips || 0;
      });
      this.rooms.set(s.code, s);
    });
    console.log(`[rooms] ${this.rooms.size} ta xona tiklandi`);
  }

  persist(code) {
    const s = this.rooms.get(code);
    if (!s) return;
    s.updatedAt = Date.now();
    store.save(s);
  }

  sweep() {
    const now = Date.now();
    for (const [code, s] of this.rooms) {
      try {
        if (now - s.updatedAt > ROOM_TTL_MS) {
          this.rooms.delete(code);
          store.remove(code);
          this.clearTimer(code);
          this.clearAwayTimer(code);
          continue;
        }
        // host qaytmadi -> hostni uzatish
        if (s.hostGoneAt && now - s.hostGoneAt > HOST_GRACE_MS) this.transferHostAuto(code);
        // zaxira tekshiruv: timer yo'qolsa ham navbat muzlab qolmaydi,
        // bo'sh xona esa avtomatik to'xtatiladi
        this.armAwayTurn(code);
      } catch (e) {
        console.error('[rooms] sweep xato:', code, e);
      }
    }
  }

  // ---------- yordamchi ----------
  newCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  get(code) { return this.rooms.get(String(code || '').toUpperCase()) || null; }

  emit(code, event, payload) { this.io.to(code).emit(event, payload); }

  sync(code) {
    const s = this.rooms.get(code);
    if (!s) return;
    this.persist(code);
    this.io.to(code).emit('state', snapshot(s));
    this.maybeRunBot(code);
    this.armAwayTurn(code);
  }

  // ---------- xona hayoti ----------
  create(user, { mode = 'multi', settings = {} } = {}) {
    const code = this.newCode();
    const host = { id: user.id };
    const s = createRoom({ code, host, mode, settings });
    s.players.push(createPlayer({ id: user.id, name: user.name, avatar: user.avatar, index: 0, cash: s.settings.startCash }));

    if (mode === 'tutorial') {
      s.players.push(createPlayer({ id: `bot-${code}`, name: 'USTOZ-BOT', isBot: true, index: 1, cash: s.settings.startCash }));
      startGame(s);
      s.order = [user.id, `bot-${code}`];    // darslikda odam birinchi
      s.turnIndex = 0;
      log(s, "Darslik boshlandi. 1-bosqich: kubik, yurish, sotib olish.", '🎓');
    }

    this.rooms.set(code, s);
    this.persist(code);
    return s;
  }

  join(code, user) {
    const s = this.get(code);
    if (!s) return { error: 'Xona topilmadi' };
    const existing = playerById(s, user.id);
    if (existing) {
      const wasAway = !existing.connected;
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.awaySkips = 0;
      existing.awayIdle = false;
      if (s.autoPaused && s.status === 'paused') { s.status = 'active'; s.autoPaused = false; }
      existing.name = existing.name || user.name;
      if (wasAway && s.status !== 'lobby') log(s, `${existing.name} qaytib keldi`, '🔌');
      return { state: s, rejoined: true };
    }
    if (s.status !== 'lobby') return { error: 'O\'yin allaqachon boshlangan' };
    if (s.players.length >= DEFAULTS.maxPlayers) return { error: 'Xona to\'la' };

    s.players.push(createPlayer({
      id: user.id, name: user.name, avatar: user.avatar,
      index: s.players.length, cash: s.settings.startCash,
    }));
    log(s, `${user.name} qo'shildi`, '👤');
    return { state: s };
  }

  leave(code, userId) {
    const s = this.get(code);
    if (!s) return;
    if (s.status === 'lobby') {
      s.players = s.players.filter((p) => p.id !== userId);
      if (!s.players.length) { this.rooms.delete(code); store.remove(code); return; }
      if (s.hostId === userId) s.hostId = s.players[0].id;
    } else {
      const p = playerById(s, userId);
      if (p) {
        p.connected = false;
        p.disconnectedAt = Date.now();
        log(s, `${p.name} chiqdi (qayta ulanishi mumkin)`, '🔌');
      }
    }
    this.sync(code);
  }

  setConnected(code, userId, connected) {
    const s = this.get(code);
    if (!s) return;
    const p = playerById(s, userId);
    if (!p) return;

    if (connected) {
      const wasAway = !p.connected;
      p.connected = true;
      p.disconnectedAt = null;
      p.awaySkips = 0;
      p.awayIdle = false;
      if (wasAway && s.status !== 'lobby') log(s, `${p.name} qaytib keldi`, '🔌');
      // Xona hamma chiqib ketgani uchun to'xtatilgan bo'lsa — o'zi davom etadi.
      if (s.autoPaused && s.status === 'paused') {
        s.status = 'active';
        s.autoPaused = false;
        log(s, "O'yin davom etmoqda", '▶️');
      }
    } else {
      p.connected = false;
      p.disconnectedAt = Date.now();
      if (s.status !== 'lobby') log(s, `${p.name} aloqasi uzildi`, '📵');
    }

    if (s.hostId === userId) s.hostGoneAt = connected ? null : Date.now();
    this.sync(code);
  }

  // ---------- qayta ulanish ----------
  // Foydalanuvchi qaysi xonalarda qatnashayotganini topadi (sahifa yangilanganda
  // mijoz kodni bilmasa ham seansni tiklash uchun).
  roomsFor(userId) {
    const out = [];
    for (const s of this.rooms.values()) {
      if (s.status === 'finished') continue;
      if (s.players.some((p) => p.id === userId && !p.isBot)) out.push(s);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ---------- yo'q o'yinchining navbati ----------
  clearAwayTimer(code) {
    const t = this.awayTimers.get(code);
    if (t) { clearTimeout(t); this.awayTimers.delete(code); }
  }

  // Navbat uzilgan o'yinchida bo'lsa, grace-period tugagach uni avtomatik
  // o'tkazadi. Busiz bitta odamning interneti uzilishi butun o'yinni muzlatadi.
  // Xonada birorta ulangan odam bormi? (botlar hisobga olinmaydi)
  hasHumanPresent(s) {
    return s.players.some((p) => !p.isBot && p.connected);
  }

  // Hamma chiqib ketgan bo'lsa o'yinni to'xtatadi. Busiz server o'yinni
  // o'zi o'ynab tugatib qo'yardi va do'stlar tanaffusdan qaytganda
  // tayyor natijani ko'rardi.
  autoPauseIfEmpty(code) {
    const s = this.rooms.get(code);
    if (!s || s.status !== 'active') return false;
    if (this.hasHumanPresent(s)) return false;
    s.status = 'paused';
    s.autoPaused = true;
    this.clearTimer(code);
    this.clearAwayTimer(code);
    log(s, "Hamma chiqib ketdi — o'yin to'xtatildi", '⏸');
    this.persist(code);
    this.io.to(code).emit('state', snapshot(s));
    return true;
  }

  armAwayTurn(code) {
    const s = this.rooms.get(code);
    if (!s) return;
    if (s.status !== 'active') return this.clearAwayTimer(code);
    if (this.autoPauseIfEmpty(code)) return;

    const p = current(s);
    if (!p || p.isBot || p.connected || !p.alive) return this.clearAwayTimer(code);

    if (this.awayTimers.has(code)) return;             // allaqachon kutilmoqda
    const since = p.disconnectedAt || Date.now();
    const wait = Math.max(1000, PLAYER_GRACE_MS - (Date.now() - since));

    const t = setTimeout(() => {
      this.awayTimers.delete(code);
      // Timer callback ichidagi ushlanmagan istisno butun jarayonni qulatadi —
      // shuning uchun bu yerda hech qachon tashqariga chiqmasligi kerak.
      try { this.autoPassTurn(code, p.id); }
      catch (e) { console.error('[rooms] autoPassTurn xato:', code, e); }
    }, wait);
    this.awayTimers.set(code, t);
  }

  autoPassTurn(code, playerId) {
    const s = this.rooms.get(code);
    if (!s || s.status !== 'active') return;
    const p = current(s);
    // holat o'zgargan bo'lishi mumkin: qaytib kelgan yoki navbat allaqachon o'tgan
    if (!p || p.id !== playerId || p.connected || p.isBot) return;

    const idle = (p.awaySkips || 0) >= MAX_AWAY_SKIPS;

    if (!idle) {
      // Birinchi bir necha navbatda server uning o'rniga kubik tashlaydi —
      // qisqa uzilishda o'yinchi iqtisodiyotdan tushib qolmaydi.
      if (s.phase === 'idle') roll(s, p.id);
      if (s.pending) skipBuy(s, p.id);
      p.awaySkips = (p.awaySkips || 0) + 1;
      log(s, `${p.name} yo'q — navbat o'tkazildi (${p.awaySkips}/${MAX_AWAY_SKIPS})`, '⏭');
      if (p.awaySkips >= MAX_AWAY_SKIPS) {
        p.awayIdle = true;
        log(s, `${p.name} uzoq vaqt yo'q — navbati endi shunchaki o'tkaziladi`, '🚪');
      }
    } else {
      // Uzoq yo'q o'yinchi uchun boshqa kubik tashlanmaydi: u ijara to'lamaydi,
      // mulk olmaydi va yo'qligida yutib ketmaydi. Mulki va puli tegilmaydi.
      p.awayIdle = true;
      s.pending = null;
      s.phase = 'resolved';        // endTurn shu bosqichni talab qiladi
      p.awaySkips += 1;
    }

    endTurn(s, p.id);
    checkFinish(s);
    this.sync(code);
  }

  transferHostAuto(code) {
    const s = this.get(code);
    if (!s) return;
    const next = s.players.find((p) => p.connected && !p.isBot && p.id !== s.hostId);
    if (!next) return;
    s.hostId = next.id;
    s.hostGoneAt = null;
    log(s, `Host huquqi ${next.name}ga o'tdi`, '👑');
    this.sync(code);
  }

  transferHost(code, fromId, toId) {
    const s = this.get(code);
    if (!s) return { error: 'Xona yo\'q' };
    if (s.hostId !== fromId) return { error: 'Faqat host uzata oladi' };
    const t = playerById(s, toId);
    if (!t || t.isBot) return { error: 'Noto\'g\'ri o\'yinchi' };
    s.hostId = toId;
    s.hostGoneAt = null;
    log(s, `Host: ${t.name}`, '👑');
    this.sync(code);
    return { ok: true };
  }

  // ---------- host amallari ----------
  start(code, userId) {
    const s = this.get(code);
    if (!s) return { error: 'Xona yo\'q' };
    if (s.hostId !== userId) return { error: 'Faqat host boshlaydi' };
    const r = startGame(s);
    if (!r.ok) return { error: r.error };
    this.sync(code);
    return { ok: true };
  }

  pause(code, userId) {
    const s = this.get(code);
    if (!s) return { error: 'Xona yo\'q' };
    if (s.hostId !== userId) return { error: 'Faqat host to\'xtata oladi' };
    if (s.status !== 'active') return { error: 'O\'yin faol emas' };
    s.status = 'paused';
    s.autoPaused = false;      // host qo'lda to'xtatdi — o'zi davom etmasin
    this.clearTimer(code);
    this.clearAwayTimer(code);
    log(s, "O'yin to'xtatildi", '⏸');
    this.sync(code);
    return { ok: true };
  }

  resume(code, userId) {
    const s = this.get(code);
    if (!s) return { error: 'Xona yo\'q' };
    if (s.hostId !== userId) return { error: 'Faqat host davom ettiradi' };
    if (s.status !== 'paused') return { error: 'O\'yin to\'xtatilmagan' };
    s.status = 'active';
    s.autoPaused = false;
    log(s, "O'yin davom etmoqda", '▶️');
    this.clearAwayTimer(code);   // grace hisobi noldan boshlansin
    this.sync(code);
    return { ok: true };
  }

  endGame(code, userId) {
    const s = this.get(code);
    if (!s) return { error: 'Xona yo\'q' };
    if (s.hostId !== userId) return { error: 'Faqat host tugata oladi' };
    finish(s, 'host');
    this.clearTimer(code);
    this.clearAwayTimer(code);
    this.sync(code);
    return { ok: true };
  }

  // ---------- bot navbati ----------
  clearTimer(code) {
    const t = this.timers.get(code);
    if (t) { clearTimeout(t); this.timers.delete(code); }
  }

  maybeRunBot(code) {
    const s = this.rooms.get(code);
    if (!s || s.status !== 'active' || this.timers.has(code)) return;
    const p = current(s);
    if (!p?.isBot || !p.alive) return;

    const step = (fn, delay) => new Promise((res) => {
      const t = setTimeout(() => {
        this.timers.delete(code);
        try { fn(); }
        catch (e) { console.error('[rooms] bot navbati xato:', code, e); }
        res();
      }, delay);
      this.timers.set(code, t);
    });

    (async () => {
      await step(() => { botRoll(s, p); this.io.to(code).emit('state', snapshot(s)); }, 900);
      await step(() => { botDecideBuy(s, p); botBuild(s, p); this.io.to(code).emit('state', snapshot(s)); }, 900);
      await step(() => {
        const offer = botMaybeDeal(s, p);
        if (offer?.ok) this.io.to(code).emit('toast', { type: 'deal', text: `${p.name} kelishuv taklif qildi` });
        botEnd(s, p);
        checkFinish(s);
        this.persist(code);
        this.io.to(code).emit('state', snapshot(s));
        this.maybeRunBot(code);
      }, 700);
    })();
  }

  // bot o'ziga kelgan taklifni baholaydi
  botAnswerDeals(code) {
    const s = this.rooms.get(code);
    if (!s) return;
    s.deals.filter((d) => d.status === 'pending').forEach((d) => {
      const target = playerById(s, d.to);
      if (!target?.isBot) return;
      setTimeout(() => {
        try {
          respondDeal(s, d.to, d.id, botJudgeDeal(s, d));
          this.sync(code);
        } catch (e) { console.error('[rooms] bot kelishuvi xato:', code, e); }
      }, 1400);
    });
  }
}
