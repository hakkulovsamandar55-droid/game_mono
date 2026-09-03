// ============================================================================
// ENGINE — o'yin qoidalari. Faqat shu fayl holatni o'zgartiradi.
// Har bir eksport qilingan amal { ok, error? } qaytaradi.
// ============================================================================
import { BOARD, BOARD_SIZE, MAX_LEVEL, groupTiles } from '../data/board.js';
import { CARDS, ECONOMY_EVENTS, ECONOMY_DURATION, ECONOMY_INTERVAL } from '../data/cards.js';
import {
  current, playerById, alivePlayers, tileOwner, propCount, levelCount,
  rentFor, upgradeCost, upgradeRefund, propertyValue, netWorth, ownsGroup, log, DEFAULTS,
  debtLimit, overDebtLimit, countInGroup,
} from './state.js';

const ok = (extra = {}) => ({ ok: true, ...extra });
const err = (error) => ({ ok: false, error });

// Mijozdan kelgan katak indeksi — hech qachon ishonchli emas.
// Tekshiruvsiz s.tiles[i].owner o'qish serverni qulatadi.
const validTile = (s, i) => Number.isInteger(i) && i >= 0 && i < BOARD_SIZE && !!s.tiles[i];

// ---------------------------------------------------------------------------
// tutorial bosqichlari
// ---------------------------------------------------------------------------
const stage = (s) => (s.tutorial ? s.tutorial.stage : 99);
export const cardsEnabled   = (s) => stage(s) >= 3;
export const economyEnabled = (s) => stage(s) >= 4;
export const upgradesEnabled= (s) => stage(s) >= 2;
export const dealsEnabled   = (s) => stage(s) >= 5;

function advanceTutorial(s, key) {
  if (!s.tutorial) return;
  const map = { buy: 2, upgrade: 3, card: 4, economy: 5, deal: 6 };
  const next = map[key];
  if (next && s.tutorial.stage < next) {
    s.tutorial.stage = next;
    s.tutorial.done.push(key);
    if (next === 6) log(s, "Darslik tugadi — endi haqiqiy o'yin!", '🎓');
  }
}

// ---------------------------------------------------------------------------
// pul harakati
// ---------------------------------------------------------------------------
const finiteMoney = (amount) => {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// Daromad kelganda uning bir qismi qarzni avtomatik kamaytiradi. Bu qarzni
// real strategik omil qiladi, lekin o'yinchini o'yindan chiqarib yubormaydi.
export function credit(s, p, amount, { autoRepay = true } = {}) {
  amount = finiteMoney(amount);
  if (!amount) return { cash: 0, repaid: 0 };

  let repaid = 0;
  if (autoRepay && (p.debt || 0) > 0) {
    repaid = Math.min(p.debt, Math.max(1, Math.round(amount * s.settings.debtAutoRepayRate)));
    p.debt -= repaid;
    p.stats.repaidDebt = (p.stats.repaidDebt || 0) + repaid;
  }
  const cash = amount - repaid;
  p.cash += cash;
  if (repaid > 0) log(s, `${p.name} daromaddan qarz yopdi −${repaid}`, '🏦');
  return { cash, repaid };
}

function releaseTile(s, p, i) {
  s.tiles[i] = { owner: null, level: 0 };
  p.props = p.props.filter((x) => x !== i);
}

export function pay(s, from, amount, to = null) {
  amount = finiteMoney(amount);
  if (!amount) return { paid: 0, borrowed: 0 };

  const fromCash = Math.min(from.cash, amount);
  const borrowed = amount - fromCash;
  from.cash -= fromCash;

  if (borrowed > 0) {
    from.debt = (from.debt || 0) + borrowed;
    from.stats.borrowed = (from.stats.borrowed || 0) + borrowed;
    from.stats.peakDebt = Math.max(from.stats.peakDebt || 0, from.debt);
    log(s, `${from.name} majburiy to'lov uchun kredit oldi +${borrowed}`, '🏦');
  }

  // Kreditor to'liq summani oladi; bank bergan qism qarz sifatida Net Worth
  // dan ayirilgani uchun tizim sof qiymat yaratmaydi.
  if (to) credit(s, to, amount);
  return { paid: amount, borrowed };
}

function relieveDebt(s, p, amount, fallback = 0) {
  amount = finiteMoney(amount);
  if ((p.debt || 0) <= 0) return credit(s, p, fallback);
  const repaid = Math.min(p.debt, amount);
  p.debt -= repaid;
  p.stats.repaidDebt = (p.stats.repaidDebt || 0) + repaid;
  log(s, `${p.name} qarz yordami oldi −${repaid}`, '🏦');
  return { cash: 0, repaid };
}

// Oddiy Math.random tanlovi bir kartani ketma-ket qaytarishi mumkin. Deck
// modeli esa 30 kartaning barchasini tasodifiy tartibda bir martadan beradi,
// keyin qayta aralashtiradi.
export function drawCard(s) {
  if (!Array.isArray(s.cardDeck)) s.cardDeck = [];
  if (!s.cardDeck.length) {
    s.cardDeck = CARDS.map((c) => c.id);
    for (let i = s.cardDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s.cardDeck[i], s.cardDeck[j]] = [s.cardDeck[j], s.cardDeck[i]];
    }
    const last = s.lastCard?.id;
    const next = s.cardDeck[s.cardDeck.length - 1];
    if (last && next === last && s.cardDeck.length > 1) {
      [s.cardDeck[0], s.cardDeck[s.cardDeck.length - 1]] = [s.cardDeck[s.cardDeck.length - 1], s.cardDeck[0]];
    }
  }
  const id = s.cardDeck.pop();
  return CARDS.find((c) => c.id === id) || CARDS[0];
}

// ---------------------------------------------------------------------------
// o'yinni boshlash
// ---------------------------------------------------------------------------
export function startGame(s) {
  if (s.status !== 'lobby') return err('O\'yin allaqachon boshlangan');
  const n = s.players.length;
  if (s.mode === 'multi' && n < DEFAULTS.minPlayers) return err(`Kamida ${DEFAULTS.minPlayers} o'yinchi kerak`);
  if (n > DEFAULTS.maxPlayers) return err('Juda ko\'p o\'yinchi');

  s.order = s.players.map((p) => p.id);
  // tasodifiy navbat
  for (let i = s.order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [s.order[i], s.order[j]] = [s.order[j], s.order[i]];
  }
  s.status = 'active';
  s.turnIndex = 0;
  s.round = 1;
  s.phase = 'idle';
  log(s, `O'yin boshlandi · ${n} o'yinchi · eng katta sof qiymat g'olib`, '🎬');
  return ok();
}

// ---------------------------------------------------------------------------
// kubik va yurish
// ---------------------------------------------------------------------------
export function roll(s, playerId, forced = null) {
  if (s.status !== 'active') return err('O\'yin faol emas');
  const p = current(s);
  if (!p || p.id !== playerId) return err('Sizning navbatingiz emas');
  if (s.phase !== 'idle') return err('Kubik allaqachon tashlangan');

  const d1 = forced ? forced[0] : 1 + Math.floor(Math.random() * 6);
  const d2 = forced ? forced[1] : 1 + Math.floor(Math.random() * 6);
  s.dice = [d1, d2];
  s.phase = 'rolled';

  const steps = d1 + d2;
  const from = p.pos;
  p.pos = (p.pos + steps) % BOARD_SIZE;

  // aylanani tugatish -> maosh
  if (p.pos < from || steps >= BOARD_SIZE) {
    p.stats.laps++;
    credit(s, p, s.settings.salary);
    log(s, `${p.name} bir aylana yakunladi +${s.settings.salary}`, '🔄');
  }

  const res = resolve(s, p);
  s.phase = 'resolved';
  return ok({ dice: [d1, d2], steps, from, to: p.pos, ...res });
}

// katakni hal qilish
function resolve(s, p) {
  const t = BOARD[p.pos];
  s.lastCard = null;

  if (t.type === 'start')    { return { landed: 'start' }; }
  if (t.type === 'square')   { log(s, `${p.name} bozor maydonida dam oldi`, '☕'); return { landed: 'square' }; }
  if (t.type === 'festival') { credit(s, p, t.amount); log(s, `${p.name} festival granti +${t.amount}`, '🎉'); return { landed: 'festival' }; }
  if (t.type === 'tax')      { pay(s, p, t.amount, null); log(s, `${p.name} soliq to'ladi −${t.amount}`, '🏛'); return { landed: 'tax' }; }

  if (t.type === 'event') {
    if (!cardsEnabled(s)) { log(s, `${p.name} hodisa qutisiga tushdi (darslikda o'chirilgan)`, '📦'); return { landed: 'event' }; }
    const card = drawCard(s);
    runCard(s, p, card);
    p.stats.events++;
    advanceTutorial(s, 'card');
    s.lastCard = { ...card, run: undefined, player: p.id };
    return { landed: 'event', card: s.lastCard };
  }

  // biznes kataklari
  const owner = tileOwner(s, p.pos);
  if (!owner) {
    if (p.cash >= t.price) {
      s.pending = { kind: 'buy', tile: p.pos, price: t.price, player: p.id };
      return { landed: 'buyable' };
    }
    log(s, `${p.name}: ${t.name} uchun pul yetmadi`, '💤');
    return { landed: 'cannot_buy' };
  }
  if (owner.id === p.id) return { landed: 'own' };

  const rent = rentFor(s, p.pos, p);
  if (rent > 0) {
    pay(s, p, rent, owner);
    owner.stats.earnedRent += rent;
    owner.stats.topRent = Math.max(owner.stats.topRent, rent);
    p.stats.paidRent += rent;
    log(s, `${p.name} → ${owner.name} ijara ${rent} (${t.name})`, '💸');
  }
  return { landed: 'rent', rent, owner: owner.id };
}

// ---------------------------------------------------------------------------
// karta API
// ---------------------------------------------------------------------------
function runCard(s, p, card) {
  const api = {
    credit: (pl, n) => { credit(s, pl, n); log(s, `${pl.name} ${card.title} +${Math.round(n)}`, card.icon); },
    debit: (pl, n) => { pay(s, pl, n, null); log(s, `${pl.name} ${card.title} −${Math.round(n)}`, card.icon); },
    propCount: (pl) => propCount(pl),
    levelCount: (pl) => levelCount(s, pl),
    groupCount: (pl, group) => countInGroup(s, pl, group),
    groupDiversity: (pl) => new Set(pl.props.map((i) => BOARD[i]?.group).filter(Boolean)).size,
    debtRelief: (pl, amount, fallback) => relieveDebt(s, pl, amount, fallback),
    payEveryone: (pl, n) => alivePlayers(s).forEach((q) => { if (q.id !== pl.id) pay(s, pl, n, q); }),
    collectEveryone: (pl, n) => alivePlayers(s).forEach((q) => { if (q.id !== pl.id) pay(s, q, n, pl); }),
    addDiscount: (pl, rounds) => {
      s.effects.discounts.push({ player: pl.id, rounds });
      log(s, `${pl.name} ijara imtiyozi (${rounds} raund)`, '🛡');
    },
    freeUpgrade: (pl) => {
      const target = pl.props.find((i) => canUpgradeTile(s, pl, i).ok);
      if (target == null) { credit(s, pl, 80); log(s, `${pl.name} yaxshilash imkoni yo'q, o'rniga +80`, '🚀'); return; }
      s.tiles[target].level++;
      pl.stats.upgrades++;
      log(s, `${pl.name} bepul yaxshiladi: ${BOARD[target].name}`, '🚀');
    },
  };
  card.run({ state: s, player: p, api });
}

// ---------------------------------------------------------------------------
// sotib olish / yaxshilash / sotish
// ---------------------------------------------------------------------------
export function buy(s, playerId) {
  const p = current(s);
  if (!p || p.id !== playerId) return err('Navbat sizda emas');
  if (!s.pending || s.pending.kind !== 'buy' || s.pending.player !== p.id) return err('Sotib olinadigan mulk yo\'q');
  const i = s.pending.tile;
  const t = BOARD[i];
  if (overDebtLimit(s, p)) return err(`Avval qarzni ${debtLimit(s, p)} limitigacha kamaytiring`);
  if (s.tiles[i].owner) return err('Mulk band');
  if (p.cash < t.price) return err('Pul yetmaydi');

  p.cash -= t.price;
  p.stats.spent += t.price;
  s.tiles[i].owner = p.id;
  p.props.push(i);
  s.pending = null;
  log(s, `${p.name} sotib oldi: ${t.name} (${t.price})`, '🏷');
  advanceTutorial(s, 'buy');
  return ok({ tile: i });
}

export function skipBuy(s, playerId) {
  const p = current(s);
  if (!p || p.id !== playerId) return err('Navbat sizda emas');
  s.pending = null;
  return ok();
}

export function canUpgradeTile(s, p, i) {
  if (!validTile(s, i)) return err('Noto\'g\'ri katak');
  const t = BOARD[i];
  if (!upgradesEnabled(s)) return err('Darslikning keyingi bosqichida ochiladi');
  if (s.tiles[i].owner !== p.id) return err('Bu sizning mulkingiz emas');
  if (overDebtLimit(s, p)) return err(`Qarz limiti oshgan (${p.debt}/${debtLimit(s, p)})`);
  if (!t.upgrade) return err('Bu obyektni yaxshilab bo\'lmaydi');
  if (s.tiles[i].level >= MAX_LEVEL) return err('Maksimal daraja');
  const cost = upgradeCost(s, i);
  if (p.cash < cost) return err(`Pul yetmaydi (${cost} kerak)`);
  return ok({ cost });
}

export function upgrade(s, playerId, i) {
  const p = playerById(s, playerId);
  if (!p) return err('O\'yinchi topilmadi');
  if (current(s)?.id !== playerId) return err('Faqat o\'z navbatingizda');
  const check = canUpgradeTile(s, p, i);
  if (!check.ok) return check;

  p.cash -= check.cost;
  p.stats.spent += check.cost;
  s.tiles[i].level++;
  p.stats.upgrades++;
  log(s, `${p.name} yaxshiladi: ${BOARD[i].name} → ${s.tiles[i].level}-daraja (−${check.cost})`, '🏗');
  advanceTutorial(s, 'upgrade');
  return ok();
}

export function sellUpgrade(s, playerId, i) {
  if (!validTile(s, i)) return err('Noto\'g\'ri katak');
  const p = playerById(s, playerId);
  if (!p || s.tiles[i].owner !== p.id) return err('Bu sizning mulkingiz emas');
  if (s.tiles[i].level <= 0) return err('Yaxshilanish yo\'q');
  s.tiles[i].level--;
  const back = upgradeRefund(s, i);
  credit(s, p, back);
  log(s, `${p.name} yaxshilanishni sotdi: ${BOARD[i].name} (+${back})`, '📉');
  return ok();
}

export function sellProperty(s, playerId, i) {
  if (!validTile(s, i)) return err('Noto\'g\'ri katak');
  const p = playerById(s, playerId);
  if (!p || s.tiles[i].owner !== p.id) return err('Bu sizning mulkingiz emas');
  if (s.tiles[i].level > 0) return err('Avval yaxshilanishlarni soting');
  const back = Math.round(propertyValue(s, i) * 0.6);
  releaseTile(s, p, i);
  credit(s, p, back);
  log(s, `${p.name} bankka sotdi: ${BOARD[i].name} (+${back})`, '🏦');
  return ok();
}

export function repayDebt(s, playerId, amount) {
  const p = playerById(s, playerId);
  if (!p) return err('O\'yinchi topilmadi');
  if (s.status !== 'active') return err('O\'yin faol emas');
  amount = finiteMoney(amount);
  if (!amount) return err('Summa noto\'g\'ri');
  if ((p.debt || 0) <= 0) return err('Qarz yo\'q');

  const repaid = Math.min(amount, p.cash, p.debt);
  if (repaid <= 0) return err('Naqd pul yetmaydi');
  p.cash -= repaid;
  p.debt -= repaid;
  p.stats.repaidDebt = (p.stats.repaidDebt || 0) + repaid;
  log(s, `${p.name} qarz to'ladi −${repaid}`, '🏦');
  return ok({ repaid, debt: p.debt });
}

// ---------------------------------------------------------------------------
// navbat almashish
// ---------------------------------------------------------------------------
export function endTurn(s, playerId) {
  if (s.status !== 'active') return err('O\'yin faol emas');
  const p = current(s);
  if (!p || p.id !== playerId) return err('Navbat sizda emas');
  if (s.phase !== 'resolved') return err('Avval kubik tashlang');

  s.pending = null;
  s.phase = 'idle';

  s.turnIndex = (s.turnIndex + 1) % s.order.length;
  if (s.turnIndex === 0) {
    s.round++;
    roundStart(s);
  }

  return ok({ next: s.order[s.turnIndex] });
}

// yangi raund boshlanishi: iqtisodiyot, kechiktirilgan to'lovlar, imtiyozlar
function roundStart(s) {
  // imtiyozlar
  s.effects.discounts.forEach((d) => d.rounds--);
  s.effects.discounts = s.effects.discounts.filter((d) => d.rounds > 0);

  // Qarz foizi har raund emas, belgilangan davrda qo'shiladi. Bu qarzni
  // e'tiborsiz qoldirmaslikka undaydi, lekin matchni majburan tugatmaydi.
  if (s.round > 1 && s.round % s.settings.debtInterestEvery === 0) {
    s.players.forEach((p) => {
      if ((p.debt || 0) <= 0) return;
      const interest = Math.max(1, Math.round(p.debt * s.settings.debtInterestRate));
      p.debt += interest;
      p.stats.debtInterest = (p.stats.debtInterest || 0) + interest;
      p.stats.peakDebt = Math.max(p.stats.peakDebt || 0, p.debt);
      log(s, `${p.name} kredit foizi +${interest}`, '🏦');
    });
  }

  // kelishuv bo'yicha kelajakdagi to'lovlar
  const due = s.effects.future.filter((f) => f.dueRound <= s.round);
  due.forEach((f) => {
    const from = playerById(s, f.from), to = playerById(s, f.to);
    if (from?.alive && to?.alive) {
      pay(s, from, f.amount, to);
      log(s, `Kelishuv to'lovi: ${from.name} → ${to.name} ${f.amount}`, '📜');
    }
  });
  s.effects.future = s.effects.future.filter((f) => f.dueRound > s.round);

  // iqtisodiy hodisa
  if (s.economy.roundsLeft > 0) {
    s.economy.roundsLeft--;
    if (s.economy.roundsLeft === 0) {
      log(s, `${s.economy.current.title} tugadi — iqtisodiyot normallashdi`, '⚖️');
      s.economy.current = null;
    }
  }
  if (economyEnabled(s) && s.round % ECONOMY_INTERVAL === 0) {
    triggerEconomy(s);
  }

  return false;
}

export function triggerEconomy(s, forcedId = null) {
  const pool = ECONOMY_EVENTS.filter((e) => e.id !== s.economy.current?.id);
  const ev = forcedId ? ECONOMY_EVENTS.find((e) => e.id === forcedId) : pool[Math.floor(Math.random() * pool.length)];
  s.economy.current = ev;
  s.economy.roundsLeft = ECONOMY_DURATION;
  s.economy.history.unshift({ id: ev.id, round: s.round, title: ev.title, icon: ev.icon });
  if (s.economy.history.length > 20) s.economy.history.length = 20;
  log(s, `${ev.icon} ${ev.title} — ${ev.text}`, ev.icon);
  advanceTutorial(s, 'economy');
  return ev;
}

// ---------------------------------------------------------------------------
// yakun
// ---------------------------------------------------------------------------
export function checkFinish(s) {
  // Avtomatik yakun yo'q. Host istalgan tanaffusda pauza qiladi va o'yinni
  // faqat kelishilgan paytda yakunlaydi.
  return s.status === 'finished';
}

export function finish(s, reason = 'manual') {
  s.status = 'finished';
  const ranking = [...s.players]
    .map((p) => ({
      id: p.id, name: p.name, token: p.token, avatar: p.avatar,
      alive: true, cash: p.cash, debt: p.debt || 0, props: p.props.length,
      levels: levelCount(s, p), netWorth: netWorth(s, p), stats: p.stats,
    }))
    .sort((a, b) => b.netWorth - a.netWorth);

  const best = (key) => s.players.reduce((a, b) => (b.stats[key] > (a?.stats[key] ?? -1) ? b : a), null);
  s.result = {
    reason,
    round: s.round,
    ranking,
    winner: ranking[0] || null,
    highlights: {
      topRent: best('topRent') ? { name: best('topRent').name, value: best('topRent').stats.topRent } : null,
      bestDeal: best('bestDeal') ? { name: best('bestDeal').name, value: best('bestDeal').stats.bestDeal } : null,
      mostProps: [...s.players].sort((a, b) => b.props.length - a.props.length)[0]?.name || null,
      mostUpgrades: best('upgrades') ? { name: best('upgrades').name, value: best('upgrades').stats.upgrades } : null,
      events: s.economy.history.length,
    },
  };
  log(s, `O'yin tugadi. G'olib: ${s.result.winner?.name ?? '—'}`, '🏆');
  return s.result;
}
