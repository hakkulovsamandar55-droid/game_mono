// ============================================================================
// Tez simulyatsiya: dvigatelni to'liq o'yin bo'yicha sinash (npm run sim)
// ============================================================================
import { createRoom, createPlayer, netWorth, current, snapshot } from '../src/game/state.js';
import { startGame, roll, endTurn, finish } from '../src/game/engine.js';
import { botDecideBuy, botBuild } from '../src/game/bot.js';
import { createDeal, respondDeal } from '../src/game/deals.js';

const N = Number(process.argv[2] || 200);
let turnsTotal = 0, dealsOk = 0, debtTotal = 0, finished = 0;

for (let g = 0; g < N; g++) {
  const s = createRoom({ code: 'SIM' + g, host: { id: 'p0' } });
  const count = 3 + (g % 3);
  for (let i = 0; i < count; i++) {
    s.players.push(createPlayer({ id: 'p' + i, name: 'P' + i, isBot: true, index: i, cash: s.settings.startCash }));
  }
  startGame(s);

  let guard = 0;
  while (s.status === 'active' && guard++ < 240) {
    const p = current(s);
    if (!p) break;
    const r = roll(s, p.id);
    if (!r.ok) { endTurn(s, p.id); continue; }
    botDecideBuy(s, p);
    botBuild(s, p);

    // vaqti-vaqti bilan kelishuv sinovi
    if (guard % 17 === 0) {
      const other = s.players.find((q) => q.id !== p.id && q.props.length);
      if (other) {
        const d = createDeal(s, p.id, {
          to: other.id,
          give: { cash: Math.min(120, p.cash), props: [] },
          receive: { cash: 0, props: [other.props[0]] },
          terms: { futurePayment: { amount: 50, payer: 'to', afterRounds: 2 } },
        });
        if (d.ok) { const rr = respondDeal(s, other.id, d.deal.id, true); if (rr.ok) dealsOk++; }
      }
    }
    endTurn(s, p.id);
    turnsTotal++;
  }
  if (s.status === 'active') finish(s, 'host');
  if (s.status === 'finished') finished++;
  debtTotal += s.players.reduce((n, p) => n + (p.debt || 0), 0);

  if (g === 0) {
    console.log('--- namuna o\'yin ---');
    console.log('raund:', s.round, 'sabab:', s.result.reason);
    s.result.ranking.forEach((r, i) => console.log(`${i + 1}. ${r.name}  NW=${r.netWorth}  cash=${r.cash} debt=${r.debt} props=${r.props} lvl=${r.levels}`));
    console.log('iqtisodiy hodisalar:', s.economy.history.map((h) => h.title).join(', '));
    console.log('snapshot bytes:', JSON.stringify(snapshot(s)).length);
  }
}

console.log(`\n${N} o'yin · Host yakunladi: ${finished} · o'rtacha navbat: ${(turnsTotal / N).toFixed(1)} · o'rtacha jami qarz: ${(debtTotal / N).toFixed(0)} · kelishuvlar: ${dealsOk}`);
