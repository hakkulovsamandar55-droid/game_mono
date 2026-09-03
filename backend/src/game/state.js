// ============================================================================
// O'yin holati va umumiy hisob-kitoblar.
// Barcha holat serverda saqlanadi — mijoz hech qachon pul/mulk o'zgartira olmaydi.
// ============================================================================
import { BOARD, BOARD_SIZE, GROUPS, TRANSPORT_RENT, UTILITY_MULT, BANK_PER_PROPERTY, groupTiles } from '../data/board.js';

export const TOKENS = ['▲', '●', '■', '◆', '★'];

export const DEFAULTS = {
  startCash: 1500,
  salary: 200,
  // Raund va vaqt chegarasi yo'q. O'yin Host yakunlaganda sof qiymat
  // bo'yicha tugaydi; iqtisodiyot ataylab tezlashtirilmaydi.
  // Qarz tizimi: majburiy to'lov yetishmasa avtomatik kredit beriladi.
  // Limit o'yinchini chiqarmaydi; faqat yangi xarid va qurilishni qarz
  // nazoratga kelguncha to'xtatadi.
  debtBaseLimit: 600,
  debtAssetRatio: 0.65,
  debtInterestRate: 0.03,
  debtInterestEvery: 3,
  debtAutoRepayRate: 0.25,
  minPlayers: 3,
  maxPlayers: 5,
};

export function createRoom({ code, host, mode = 'multi', settings = {} }) {
  const now = Date.now();
  return {
    code,
    mode,                       // 'multi' | 'tutorial'
    status: 'lobby',            // lobby | active | paused | finished
    hostId: host.id,
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULTS, ...settings },
    players: [],
    order: [],
    turnIndex: 0,
    round: 1,
    dice: [0, 0],
    phase: 'idle',              // idle | rolled | resolved
    autoPaused: false,          // hamma chiqib ketgani uchun to'xtatilganmi
    pending: null,              // { kind:'buy', tile } — joriy o'yinchi qarori
    tiles: BOARD.map(() => ({ owner: null, level: 0 })),
    economy: { current: null, roundsLeft: 0, history: [] },
    deals: [],
    effects: { discounts: [], future: [] },
    lastCard: null,
    cardDeck: [],                 // 30 karta aralashtirilib, takrorsiz tortiladi
    log: [],
    tutorial: mode === 'tutorial' ? { stage: 1, done: [] } : null,
    result: null,
    hostGoneAt: null,
  };
}

export function createPlayer({ id, name, avatar = null, isBot = false, index = 0, cash }) {
  return {
    id,
    name: (name || 'Player').slice(0, 14),
    avatar,
    isBot,
    token: TOKENS[index % TOKENS.length],
    cash: cash ?? DEFAULTS.startCash,
    pos: 0,
    props: [],
    alive: true,
    spectator: false,       // eski saqlangan holatlar bilan moslik uchun
    debt: 0,
    connected: true,
    disconnectedAt: null,   // uzilgan vaqt (grace-period hisobi uchun)
    awaySkips: 0,           // yo'qligida avtomatik o'tkazilgan navbatlar
    awayIdle: false,        // uzoq yo'q: navbati kubiksiz o'tkaziladi
    ready: false,
    stats: {
      spent: 0, earnedRent: 0, paidRent: 0, topRent: 0,
      deals: 0, bestDeal: 0, laps: 0, events: 0, upgrades: 0,
      borrowed: 0, repaidDebt: 0, debtInterest: 0, peakDebt: 0,
    },
  };
}

// --------------------------------------------------------------------------
// yordamchilar
// --------------------------------------------------------------------------
export const playerById = (s, id) => s.players.find((p) => p.id === id) || null;
export const current = (s) => playerById(s, s.order[s.turnIndex]);
export const alivePlayers = (s) => s.players.filter((p) => p.alive);
export const tileOwner = (s, i) => (s.tiles[i].owner ? playerById(s, s.tiles[i].owner) : null);
export const propCount = (p) => p.props.length;
export const levelCount = (s, p) => p.props.reduce((n, i) => n + s.tiles[i].level, 0);

export function ownsGroup(s, player, groupKey) {
  const tiles = groupTiles(groupKey);
  return tiles.length > 0 && tiles.every((i) => s.tiles[i].owner === player.id);
}

export function countInGroup(s, player, groupKey) {
  return groupTiles(groupKey).filter((i) => s.tiles[i].owner === player.id).length;
}

export function economyMult(s, groupKey) {
  const ev = s.economy.current;
  if (!ev || s.economy.roundsLeft <= 0) return 1;
  return ev.mods?.[groupKey] ?? 1;
}

// Aktivlarga tayangan yumshoq kredit limiti. Undan oshish o'yinchini
// chetlashtirmaydi — faqat yangi ixtiyoriy xarajatlarni vaqtincha bloklaydi.
export function debtLimit(s, p) {
  const assets = p.props.reduce((n, i) => n + propertyValue(s, i), 0);
  return Math.max(0, Math.round(s.settings.debtBaseLimit + assets * s.settings.debtAssetRatio));
}

export function overDebtLimit(s, p) {
  return (p.debt || 0) > debtLimit(s, p);
}

export function upgradeMult(s) {
  const ev = s.economy.current;
  if (!ev || s.economy.roundsLeft <= 0) return 1;
  return ev.upgradeMod ?? 1;
}

export function baseUpgradeCost(s, tileIndex) {
  const t = BOARD[tileIndex];
  if (!t || !t.upgrade || !s.tiles[tileIndex]) return 0;
  const lvl = s.tiles[tileIndex].level;
  return Math.round(t.upgrade * (1 + lvl * 0.35));   // har daraja qimmatroq
}

export function upgradeCost(s, tileIndex) {
  const t = BOARD[tileIndex];
  if (!t || !t.upgrade || !s.tiles[tileIndex]) return 0;
  const owner = tileOwner(s, tileIndex);
  const groupDiscount = owner && ownsGroup(s, owner, t.group) ? 0.85 : 1;  // guruh egasiga arzonroq
  return Math.round(baseUpgradeCost(s, tileIndex) * groupDiscount * upgradeMult(s));
}

// Yaxshilanishni sotishda qaytariladigan summa iqtisodiy hodisaga bog'liq
// EMAS — aks holda arzon davrda qurib qimmat davrda sotish pul yaratardi.
export function upgradeRefund(s, tileIndex) {
  return Math.round(baseUpgradeCost(s, tileIndex) * 0.5);
}

// Ijara hisobi — barcha guruh xususiyatlari shu yerda
export function rentFor(s, tileIndex, payer) {
  const t = BOARD[tileIndex];
  const cell = s.tiles[tileIndex];
  const owner = tileOwner(s, tileIndex);
  if (!owner || !t.group || owner.id === payer?.id) return 0;

  let rent;
  if (t.group === 'transport') {
    rent = TRANSPORT_RENT[countInGroup(s, owner, 'transport')] || 0;
  } else if (t.group === 'utility') {
    const roll = (s.dice[0] || 3) + (s.dice[1] || 4);
    rent = roll * (UTILITY_MULT[countInGroup(s, owner, 'utility')] || 0);
  } else if (t.group === 'finance') {
    rent = BANK_PER_PROPERTY * propCount(owner);
  } else {
    rent = t.rent[cell.level];
    // to'liq guruh bonusi: bo'sh obyektda x2, yaxshilanganda x1.5
    if (ownsGroup(s, owner, t.group)) rent *= cell.level === 0 ? 2 : 1.5;
  }

  rent *= economyMult(s, t.group);
  // kartadan olingan chegirma
  if (payer) {
    const d = s.effects.discounts.find((x) => x.player === payer.id && x.rounds > 0);
    if (d) rent *= 0.5;
  }
  return Math.max(0, Math.round(rent));
}

export function propertyValue(s, tileIndex) {
  const t = BOARD[tileIndex];
  const lvl = s.tiles[tileIndex].level;
  let v = t.price;
  for (let l = 0; l < lvl; l++) v += Math.round((t.upgrade || 0) * (1 + l * 0.35));
  return v;
}

export function netWorth(s, p) {
  let v = p.cash;
  p.props.forEach((i) => { v += propertyValue(s, i); });
  v -= p.debt || 0;
  s.effects.future.forEach((f) => {
    if (f.to === p.id) v += f.amount;
    if (f.from === p.id) v -= f.amount;
  });
  return Math.round(v);
}

export function log(s, text, icon = '·') {
  s.log.unshift({ t: Date.now(), text, icon });
  if (s.log.length > 60) s.log.length = 60;
}

// mijozga yuboriladigan snapshot (barcha o'yinchilar bir xil ko'radi)
export function snapshot(s) {
  return {
    code: s.code,
    mode: s.mode,
    status: s.status,
    hostId: s.hostId,
    settings: s.settings,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot, token: p.token,
      cash: p.cash, pos: p.pos, props: p.props, alive: p.alive,
      spectator: !!p.spectator,
      debt: p.debt || 0,
      debtLimit: debtLimit(s, p),
      overDebtLimit: overDebtLimit(s, p),
      connected: p.connected, disconnectedAt: p.disconnectedAt,
      awaySkips: p.awaySkips, awayIdle: p.awayIdle, stats: p.stats,
      netWorth: netWorth(s, p),
    })),
    order: s.order,
    turnIndex: s.turnIndex,
    currentId: s.order[s.turnIndex] || null,
    round: s.round,
    dice: s.dice,
    phase: s.phase,
    autoPaused: !!s.autoPaused,
    pending: s.pending,
    // har katak uchun tayyor hisoblangan ko'rsatkichlar (mijoz qoidalarni takrorlamaydi)
    tiles: s.tiles.map((c, i) => ({
      owner: c.owner,
      level: c.level,
      rent: rentFor(s, i, null),
      upCost: upgradeCost(s, i),
      value: BOARD[i].type === 'prop' ? propertyValue(s, i) : 0,
    })),
    economy: s.economy,
    deals: s.deals.filter((d) => d.status === 'pending'),
    effects: s.effects,
    lastCard: s.lastCard,
    log: s.log.slice(0, 25),
    tutorial: s.tutorial,
    result: s.result,
    boardSize: BOARD_SIZE,
    groups: GROUPS,
  };
}
