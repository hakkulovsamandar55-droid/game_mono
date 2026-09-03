// ============================================================================
// BOT — darslik va bo'sh o'rinlar uchun sodda, lekin mantiqiy raqib.
// ============================================================================
import { BOARD } from '../data/board.js';
import { buy, skipBuy, upgrade, canUpgradeTile, endTurn, roll, repayDebt } from './engine.js';
import { createDeal } from './deals.js';
import { countInGroup, upgradeCost, playerById } from './state.js';

const RESERVE = 120;

export function botRoll(s, bot) {
  return roll(s, bot.id);
}

export function botDecideBuy(s, bot) {
  if (!s.pending || s.pending.kind !== 'buy') return;
  const t = BOARD[s.pending.tile];
  const synergy = countInGroup(s, bot, t.group) > 0;         // guruhni to'ldirish istagi
  const strategic = ['transport', 'utility', 'finance'].includes(t.group);
  const afford = bot.cash - t.price;

  if (afford >= RESERVE || (synergy && afford >= 60) || (strategic && afford >= 120)) buy(s, bot.id);
  else skipBuy(s, bot.id);
}

export function botBuild(s, bot) {
  // Bot ham qarzni e'tiborsiz qoldirmaydi: zaxiradan ortiq pulni avval
  // qarzga beradi, keyin qurilish haqida o'ylaydi.
  if ((bot.debt || 0) > 0 && bot.cash > RESERVE) {
    repayDebt(s, bot.id, Math.min(bot.debt, bot.cash - RESERVE));
  }
  let guard = 0;
  while (guard++ < 6) {
    const candidates = bot.props
      .filter((i) => canUpgradeTile(s, bot, i).ok)
      .sort((a, b) => BOARD[b].rent[1] - BOARD[a].rent[1]);
    const target = candidates[0];
    if (target == null) break;
    if (bot.cash - upgradeCost(s, target) < RESERVE) break;
    upgrade(s, bot.id, target);
  }
}

export function botEnd(s, bot) {
  return endTurn(s, bot.id);
}

// darslikda bot bitta sodda taklif yuboradi (5-bosqich)
export function botMaybeDeal(s, bot) {
  if (s.mode !== 'tutorial' || !s.tutorial || s.tutorial.stage < 5) return null;
  if (s.deals.some((d) => d.status === 'pending')) return null;
  const human = s.players.find((p) => !p.isBot && p.alive);
  if (!human || !human.props.length) return null;

  // botga guruhni to'ldirish uchun kerak bo'lgan mulkni so'raydi
  const wanted = human.props.find((i) => BOARD[i].group && countInGroup(s, bot, BOARD[i].group) > 0);
  if (wanted == null) return null;

  const price = Math.round(BOARD[wanted].price * 1.8);
  if (bot.cash < price + 100) return null;

  return createDeal(s, bot.id, {
    to: human.id,
    give: { cash: price, props: [] },
    receive: { cash: 0, props: [wanted] },
    terms: {},
  });
}

// bot kelgan taklifga javob (oddiy qiymat solishtiruvi)
export function botJudgeDeal(s, deal) {
  const bot = playerById(s, deal.to);
  const val = (side) => side.cash + side.props.reduce((n, i) => n + BOARD[i].price, 0);
  const gain = val(deal.give);          // botga keladi
  const loss = val(deal.receive);       // botdan ketadi
  return gain >= loss * 0.9;
}
