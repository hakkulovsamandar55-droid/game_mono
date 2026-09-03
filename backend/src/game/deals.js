// ============================================================================
// DEAL SYSTEM — tuzilmali kelishuvlar.
// Teng qiymat talab qilinmaydi: bir tomon hech narsa bermasligi ham mumkin.
// Server tekshiradi va atomik bajaradi.
// ============================================================================
import { randomUUID } from 'node:crypto';
import { BOARD } from '../data/board.js';
import { playerById, propertyValue, log, overDebtLimit, debtLimit } from './state.js';
import { dealsEnabled } from './engine.js';

const ok = (extra = {}) => ({ ok: true, ...extra });
const err = (error) => ({ ok: false, error });
const nid = () => randomUUID();

const MAX_PENDING_PER_PLAYER = 4;
const KEEP_RESOLVED = 20;

// Faol takliflar saqlanadi, yakunlanganlaridan faqat oxirgilari qoladi.
function pruneDeals(s) {
  const pending = s.deals.filter((d) => d.status === 'pending');
  const resolved = s.deals.filter((d) => d.status !== 'pending').slice(0, KEEP_RESOLVED);
  s.deals = [...pending, ...resolved];
}

function normSide(side = {}) {
  const rawCash = Number(side.cash);
  return {
    cash: Number.isFinite(rawCash) ? Math.max(0, Math.round(rawCash)) : 0,
    props: Array.isArray(side.props) ? [...new Set(side.props.map(Number))].filter((i) => BOARD[i]?.type === 'prop') : [],
  };
}

function validateSide(s, player, side, label) {
  if (side.cash > player.cash) return err(`${label}: naqd pul yetarli emas`);
  if (side.cash > 0 && overDebtLimit(s, player))
    return err(`${label}: qarz ${debtLimit(s, player)} limitidan oshgan`);
  for (const i of side.props) {
    if (s.tiles[i].owner !== player.id) return err(`${label}: ${BOARD[i].name} unga tegishli emas`);
  }
  return ok();
}

export function createDeal(s, fromId, payload) {
  if (s.status !== 'active') return err('O\'yin faol emas');
  if (!dealsEnabled(s)) return err('Kelishuvlar darslikning 5-bosqichida ochiladi');

  const from = playerById(s, fromId);
  const to = playerById(s, payload.to);
  if (!from?.alive || !to?.alive) return err('O\'yinchi mavjud emas');
  if (from.id === to.id) return err('O\'zingiz bilan kelishib bo\'lmaydi');
  if (s.deals.some((d) => d.status === 'pending' && d.from === from.id && d.to === to.id))
    return err('Bu o\'yinchiga yuborilgan taklif hali javobsiz');
  if (s.deals.filter((d) => d.status === 'pending' && d.from === from.id).length >= MAX_PENDING_PER_PLAYER)
    return err('Javobsiz takliflaringiz juda ko\'p');

  const give = normSide(payload.give);
  const receive = normSide(payload.receive);
  if (!give.cash && !give.props.length && !receive.cash && !receive.props.length && !payload.terms)
    return err('Bo\'sh kelishuv');

  const v1 = validateSide(s, from, give, 'Siz'); if (!v1.ok) return v1;
  const v2 = validateSide(s, to, receive, to.name); if (!v2.ok) return v2;

  const terms = {};
  const futureAmount = Number(payload.terms?.futurePayment?.amount);
  if (Number.isFinite(futureAmount) && futureAmount > 0) {
    const fp = payload.terms.futurePayment;
    terms.futurePayment = {
      amount: Math.min(5000, Math.round(futureAmount)),
      payer: fp.payer === 'to' ? 'to' : 'from',
      afterRounds: Math.min(6, Math.max(1, Math.round(fp.afterRounds || 2))),
    };
    const futurePayer = terms.futurePayment.payer === 'from' ? from : to;
    if (overDebtLimit(s, futurePayer))
      return err(`${futurePayer.name}: qarz limiti oshgan, yangi majburiyat olib bo'lmaydi`);
  }
  if (payload.terms?.rentExemption?.rounds > 0) {
    const re = payload.terms.rentExemption;
    terms.rentExemption = {
      beneficiary: re.beneficiary === 'to' ? 'to' : 'from',
      rounds: Math.min(6, Math.max(1, Math.round(re.rounds))),
    };
  }

  const deal = {
    id: nid(), from: from.id, to: to.id, give, receive, terms,
    status: 'pending', createdAt: Date.now(),
  };
  s.deals.unshift(deal);
  pruneDeals(s);
  log(s, `${from.name} → ${to.name}: kelishuv taklifi`, '🤝');
  return ok({ deal });
}

export function respondDeal(s, playerId, dealId, accept) {
  const deal = s.deals.find((d) => d.id === dealId);
  if (!deal || deal.status !== 'pending') return err('Kelishuv topilmadi');
  if (deal.to !== playerId) return err('Bu taklif sizga emas');

  const from = playerById(s, deal.from);
  const to = playerById(s, deal.to);
  if (!from?.alive || !to?.alive) { deal.status = 'cancelled'; return err('O\'yinchi o\'yindan chiqqan'); }

  if (!accept) {
    deal.status = 'rejected';
    pruneDeals(s);
    log(s, `${to.name} kelishuvni rad etdi`, '✖️');
    return ok({ accepted: false });
  }

  // qayta tekshirish — holat o'zgargan bo'lishi mumkin
  const v1 = validateSide(s, from, deal.give, from.name); if (!v1.ok) { deal.status = 'cancelled'; return v1; }
  const v2 = validateSide(s, to, deal.receive, to.name); if (!v2.ok) { deal.status = 'cancelled'; return v2; }

  // atomik bajarish
  transfer(s, from, to, deal.give);
  transfer(s, to, from, deal.receive);

  if (deal.terms.futurePayment) {
    const t = deal.terms.futurePayment;
    s.effects.future.push({
      from: t.payer === 'from' ? from.id : to.id,
      to: t.payer === 'from' ? to.id : from.id,
      amount: t.amount,
      dueRound: s.round + t.afterRounds,
    });
  }
  if (deal.terms.rentExemption) {
    const t = deal.terms.rentExemption;
    s.effects.discounts.push({
      player: t.beneficiary === 'from' ? from.id : to.id,
      rounds: t.rounds,
      source: 'deal',
    });
  }

  const value = dealValue(s, deal);
  [from, to].forEach((p) => {
    p.stats.deals++;
    p.stats.bestDeal = Math.max(p.stats.bestDeal, value);
  });
  deal.status = 'accepted';
  pruneDeals(s);
  log(s, `${from.name} ↔ ${to.name} kelishuv qabul qilindi (${value})`, '✅');
  return ok({ accepted: true, deal });
}

export function cancelDeal(s, playerId, dealId) {
  const deal = s.deals.find((d) => d.id === dealId);
  if (!deal || deal.status !== 'pending') return err('Kelishuv topilmadi');
  if (deal.from !== playerId) return err('Faqat taklif egasi bekor qiladi');
  deal.status = 'cancelled';
  pruneDeals(s);
  return ok();
}

function transfer(s, from, to, side) {
  if (side.cash > 0) {
    const amt = Math.min(side.cash, from.cash);
    from.cash -= amt;
    to.cash += amt;
  }
  side.props.forEach((i) => {
    from.props = from.props.filter((x) => x !== i);
    to.props.push(i);
    s.tiles[i].owner = to.id;
  });
}

export function dealValue(s, deal) {
  const side = (x) => x.cash + x.props.reduce((n, i) => n + propertyValue(s, i), 0);
  return side(deal.give) + side(deal.receive);
}
