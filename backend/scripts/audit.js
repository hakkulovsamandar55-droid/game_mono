// ============================================================================
// AUDIT — ko'p sonli o'yinni tasodifiy harakatlar bilan o'ynab, har qadamdan
// keyin o'yin holatining invariantlarini tekshiradi.
//   node scripts/audit.js [gameCount]
// ============================================================================
import { createRoom, createPlayer, playerById, current, netWorth, propertyValue } from '../src/game/state.js';
import * as E from '../src/game/engine.js';
import { createDeal, respondDeal, cancelDeal } from '../src/game/deals.js';
import { BOARD, MAX_LEVEL } from '../src/data/board.js';

const problems = new Map();
function flag(key, detail) {
  if (!problems.has(key)) problems.set(key, { count: 0, sample: detail });
  problems.get(key).count++;
}

// ---------------------------------------------------------------------------
function checkInvariants(s, where) {
  const ids = new Set(s.players.map((p) => p.id));

  for (const p of s.players) {
    if (p.cash < 0) flag('naqd pul manfiy', `${where}: ${p.name} cash=${p.cash}`);
    if (!Number.isFinite(p.cash)) flag('naqd pul son emas', `${where}: ${p.name} cash=${p.cash}`);
    if (!Number.isInteger(p.cash)) flag('naqd pul butun son emas', `${where}: ${p.name} cash=${p.cash}`);
    if (p.pos < 0 || p.pos >= BOARD.length) flag('pozitsiya doskadan tashqarida', `${where}: pos=${p.pos}`);
    if ((p.debt || 0) < 0) flag('qarz manfiy', `${where}: ${p.name} debt=${p.debt}`);
    if (!Number.isFinite(p.debt || 0)) flag('qarz son emas', `${where}: ${p.name} debt=${p.debt}`);
    if (!Number.isInteger(p.debt || 0)) flag('qarz butun son emas', `${where}: ${p.name} debt=${p.debt}`);
    if (!p.alive || p.spectator) flag('o\'yinchi noto\'g\'ri chetlashtirilgan', `${where}: ${p.name}`);
    if (new Set(p.props).size !== p.props.length) flag('props ro\'yxatida takror', `${where}: ${p.name}`);
    for (const i of p.props) {
      if (s.tiles[i].owner !== p.id) flag('props ↔ tiles nomuvofiq', `${where}: ${p.name} tile ${i}`);
    }
    for (const k of ['spent', 'earnedRent', 'paidRent', 'topRent', 'deals', 'bestDeal', 'laps', 'events', 'upgrades', 'borrowed', 'repaidDebt', 'debtInterest', 'peakDebt']) {
      if (!Number.isFinite(p.stats[k])) flag(`stats.${k} son emas`, `${where}: ${p.name}`);
    }
  }

  s.tiles.forEach((c, i) => {
    if (c.owner) {
      if (!ids.has(c.owner)) flag('katak egasi mavjud emas', `${where}: tile ${i}`);
      const o = playerById(s, c.owner);
      if (o && !o.props.includes(i)) flag('tiles ↔ props nomuvofiq', `${where}: tile ${i}`);
    }
    if (c.level < 0 || c.level > MAX_LEVEL) flag('bino darajasi diapazondan tashqarida', `${where}: tile ${i} lvl=${c.level}`);
    if (c.level > 0 && !c.owner) flag('egasiz katakda bino bor', `${where}: tile ${i}`);
    if (c.level > 0 && BOARD[i].type !== 'prop') flag('yaxshilanmaydigan katakda bino', `${where}: tile ${i}`);
    if (c.level > 0 && !BOARD[i].upgrade) flag('upgrade=0 katakda bino', `${where}: tile ${i}`);
  });

  const owned = s.tiles.filter((c) => c.owner).length;
  const claimed = s.players.reduce((n, p) => n + p.props.length, 0);
  if (owned !== claimed) flag('egalik hisobi mos kelmaydi', `${where}: tiles=${owned} props=${claimed}`);

  if (s.status === 'active') {
    if (s.turnIndex < 0 || s.turnIndex >= s.order.length) flag('turnIndex diapazondan tashqarida', where);
    if (!current(s)) flag('joriy o\'yinchi topilmadi', where);
    if (!['idle', 'rolled', 'resolved'].includes(s.phase)) flag('noma\'lum faza', `${where}: ${s.phase}`);
    // Matchning davomiyligi ataylab cheklanmagan; audit faqat holat
    // izchilligini belgilangan qadamlar davomida tekshiradi.
  }

  for (const d of s.deals) {
    if (!ids.has(d.from) || !ids.has(d.to)) flag('kelishuvda mavjud bo\'lmagan o\'yinchi', where);
    if (!['pending', 'accepted', 'rejected', 'cancelled'].includes(d.status)) flag('noma\'lum kelishuv statusi', where);
  }

  for (const f of s.effects.future) {
    if (!Number.isFinite(f.amount) || f.amount < 0) flag('kelajak to\'lovi noto\'g\'ri', where);
  }

  if (s.status === 'finished') {
    if (!s.result) flag('tugagan o\'yinda natija yo\'q', where);
    else if (s.result.ranking.length !== s.players.length) flag('reytingda o\'yinchi yetishmaydi', where);
  }
}

// ---------------------------------------------------------------------------
function randomGame(seedIndex, nPlayers) {
  const s = createRoom({ code: `T${seedIndex}`, host: { id: 'p0' }, mode: 'multi' });
  for (let i = 0; i < nPlayers; i++) {
    s.players.push(createPlayer({ id: `p${i}`, name: `P${i}`, index: i, cash: s.settings.startCash }));
  }
  E.startGame(s);
  checkInvariants(s, 'start');

  const R = () => Math.random();
  let guard = 0;

  while (s.status === 'active' && guard++ < 400) {
    const p = current(s);
    if (!p) break;

    // tasodifiy "shovqin" harakatlar — noto'g'ri chaqiruvlar ham sinaladi
    if (R() < 0.25) {
      const other = s.players[Math.floor(R() * s.players.length)];
      const mine = p.props[Math.floor(R() * p.props.length)];
      const theirs = other.props[Math.floor(R() * other.props.length)];
      const res = createDeal(s, p.id, {
        to: other.id,
        give: { cash: Math.floor(R() * 400), props: mine != null ? [mine] : [] },
        receive: { cash: Math.floor(R() * 400), props: theirs != null ? [theirs] : [] },
        terms: R() < 0.3 ? { futurePayment: { amount: Math.floor(R() * 200), payer: 'to', afterRounds: 2 } } : undefined,
      });
      if (res.ok && R() < 0.7) respondDeal(s, other.id, res.deal.id, R() < 0.6);
      else if (res.ok && R() < 0.5) cancelDeal(s, p.id, res.deal.id);
      checkInvariants(s, 'deal');
    }

    if (R() < 0.15) {
      const i = p.props[Math.floor(R() * p.props.length)];
      if (i != null) {
        if (R() < 0.6) E.upgrade(s, p.id, i);
        else if (R() < 0.5) E.sellUpgrade(s, p.id, i);
        else E.sellProperty(s, p.id, i);
        checkInvariants(s, 'build');
      }
    }

    // Qarz tizimini ham fuzz qilamiz: naqd puldan katta majburiy to'lov
    // o'yinchini chiqarmasdan qarzga o'tishi kerak.
    if (R() < 0.08) {
      const creditor = R() < 0.5
        ? s.players.find((q) => q.id !== p.id)
        : null;
      E.pay(s, p, 500 + Math.floor(R() * 1800), creditor);
      checkInvariants(s, 'debt');
    }

    // navbat oqimi — ba'zan noto'g'ri tartibda chaqiriladi
    if (R() < 0.1) E.endTurn(s, p.id);
    if (R() < 0.1) E.buy(s, p.id);

    if (s.phase === 'idle') { E.roll(s, p.id); checkInvariants(s, 'roll'); }
    if (s.pending) {
      if (R() < 0.65) E.buy(s, p.id); else E.skipBuy(s, p.id);
      checkInvariants(s, 'buy');
    }
    if (s.status === 'active') { E.endTurn(s, p.id); checkInvariants(s, 'endTurn'); }
  }

  // Economic Village avtomatik tugamaydi: audit yakunida Host tugatishini
  // simulyatsiya qilib natija shaklini ham tekshiramiz.
  if (s.status === 'active') E.finish(s, 'audit');
  checkInvariants(s, 'finish');
  return s;
}

// ---------------------------------------------------------------------------
const N = Number(process.argv[2] || 600);
const lengths = [];
const debtShares = [];
let finished = 0;

for (let i = 0; i < N; i++) {
  const n = 3 + (i % 3);
  let s;
  try {
    s = randomGame(i, n);
  } catch (e) {
    flag(`ISTISNO: ${e.message}`, e.stack?.split('\n')[1]?.trim() || '');
    continue;
  }
  if (s.status === 'finished') finished++;
  lengths.push(s.round);
  debtShares.push(s.players.filter((p) => (p.debt || 0) > 0).length / n);
}

const avg = (a) => (a.reduce((x, y) => x + y, 0) / (a.length || 1));
console.log(`\n=== AUDIT: ${N} o'yin ===`);
console.log(`Host yakunlagan: ${finished}/${N} · o'rtacha sinov raundi: ${avg(lengths).toFixed(1)} · qarzdor ulushi: ${(avg(debtShares) * 100).toFixed(0)}%`);

if (!problems.size) {
  console.log('\nInvariant buzilishi topilmadi.');
} else {
  console.log(`\n${problems.size} xil muammo topildi:\n`);
  [...problems.entries()].sort((a, b) => b[1].count - a[1].count).forEach(([k, v]) => {
    console.log(`  [${String(v.count).padStart(6)}]  ${k}`);
    console.log(`            ${v.sample}`);
  });
}
process.exit(problems.size ? 1 : 0);
