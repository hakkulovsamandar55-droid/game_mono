// ============================================================================
// EDGE — aniq stsenariylar. Invariant emas, MANTIQIY xatolarni qidiradi.
//   node scripts/edge.js
// ============================================================================
import { createRoom, createPlayer, playerById, propertyValue, netWorth, upgradeCost, rentFor, debtLimit } from '../src/game/state.js';
import * as E from '../src/game/engine.js';
import { createDeal, respondDeal } from '../src/game/deals.js';
import { BOARD, groupTiles } from '../src/data/board.js';
import { CARDS } from '../src/data/cards.js';

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

function game(n = 3, cash = 1500) {
  const s = createRoom({ code: 'EDGE', host: { id: 'p0' }, mode: 'multi' });
  for (let i = 0; i < n; i++) {
    s.players.push(createPlayer({ id: `p${i}`, name: `P${i}`, index: i, cash }));
  }
  E.startGame(s);
  s.order = s.players.map((p) => p.id);   // barqaror tartib
  s.turnIndex = 0;
  return s;
}
const give = (s, pid, tile, level = 0) => {
  const p = playerById(s, pid);
  s.tiles[tile] = { owner: pid, level };
  if (!p.props.includes(tile)) p.props.push(tile);
};
const propTiles = BOARD.map((b, i) => (b.type === 'prop' && b.upgrade ? i : -1)).filter((i) => i >= 0);

console.log('\n=== 1. QARZ: pul yetmasa o\'yinchi qolishi ===');
{
  const s = game();
  const a = playerById(s, 'p0'), b = playerById(s, 'p1');
  const tile = propTiles[0];
  give(s, 'p0', tile, 3);
  a.cash = 40; b.cash = 10;
  E.pay(s, a, 240, b);
  t('yetishmagan summa qarzga o\'tadi', a.debt === 200, `qarz=${a.debt}`);
  t('o\'yinchi chetlashtirilmaydi', a.alive && !a.spectator);
  t('mulk va daraja egasida qoladi', s.tiles[tile].owner === 'p0' && s.tiles[tile].level === 3);
  t('kreditor to\'liq summani oladi', b.cash === 250, `cash=${b.cash}`);

  E.credit(s, a, 100);
  t('daromad qarzni avtomatik kamaytiradi', a.debt === 175 && a.cash === 75,
    `cash=${a.cash} debt=${a.debt}`);
  E.repayDebt(s, a.id, 50);
  t('qarzni qo\'lda to\'lash ishlaydi', a.debt === 125 && a.cash === 25);

  a.debt = debtLimit(s, a) + 1;
  a.cash = 5000;
  const buyTile = propTiles[1];
  s.pending = { kind: 'buy', tile: buyTile, price: BOARD[buyTile].price, player: a.id };
  t('limit oshsa yangi xarid bloklanadi', E.buy(s, a.id).ok === false && !s.tiles[buyTile].owner);

  a.debt = 1000;
  s.round = 2;
  s.turnIndex = s.order.length - 1;
  s.phase = 'resolved';
  E.endTurn(s, s.order[s.turnIndex]);
  t('belgilangan raundda foiz qo\'shiladi', a.debt === 1030, `debt=${a.debt}`);
}

console.log('\n=== 2. KELISHUV: takliflar cheksiz to\'planmasligi ===');
{
  const s = game();
  for (let i = 0; i < 300; i++) {
    const r = createDeal(s, 'p0', { to: 'p1', give: { cash: 1 }, receive: {} });
    if (r.ok) respondDeal(s, 'p1', r.deal.id, false);   // rad etiladi, lekin saqlanadi
  }
  t('kelishuvlar ro\'yxati cheklangan', s.deals.length <= 60, `hozir ${s.deals.length} ta`);
}

console.log('\n=== 3. IQTISODIY TARIX cheksiz o\'smasligi ===');
{
  const s = game();
  for (let i = 0; i < 200; i++) E.triggerEconomy(s);
  t('iqtisodiy tarix cheklangan', s.economy.history.length <= 40, `hozir ${s.economy.history.length} ta`);
}

console.log('\n=== 4. YAXSHILASH: sotib olish/sotish arbitraji ===');
{
  const s = game();
  const tile = propTiles[0];
  give(s, 'p0', tile);
  const p = playerById(s, 'p0');
  p.cash = 5000;
  const before = p.cash;
  E.upgrade(s, 'p0', tile);
  E.sellUpgrade(s, 'p0', tile);
  t('qur→sot aylanishi pul yaratmaydi', p.cash <= before, `${before} → ${p.cash}`);
  t('qur→sot aylanishi jarimasiz emas', p.cash < before, `${before} → ${p.cash}`);
}

console.log('\n=== 5. IQTISODIY HODISA arbitraji ===');
{
  const s = game();
  const tile = propTiles[0];
  give(s, 'p0', tile);
  const p = playerById(s, 'p0');
  p.cash = 9000;
  // arzon davrda quramiz, qimmat davrda sotamiz
  s.economy.current = { id: 'x', title: 'X', mods: {}, upgradeMod: 0.5 };
  s.economy.roundsLeft = 5;
  const c1 = p.cash;
  E.upgrade(s, 'p0', tile);
  s.economy.current = { id: 'y', title: 'Y', mods: {}, upgradeMod: 2.0 };
  E.sellUpgrade(s, 'p0', tile);
  t('iqtisodiy hodisa qurilish arbitrajiga yo\'l qo\'ymaydi', p.cash <= c1, `${c1} → ${p.cash}`);
}

console.log('\n=== 6. NAVBAT: qarzdor o\'yinchi ham davom etadi ===');
{
  const s = game(4);
  playerById(s, 'p1').debt = debtLimit(s, playerById(s, 'p1')) + 5000;
  s.phase = 'resolved';
  E.endTurn(s, 'p0');
  const cur = s.order[s.turnIndex];
  t('qarzdor o\'yinchi navbat oladi', cur === 'p1' && playerById(s, cur).alive, `navbat: ${cur}`);
}

console.log('\n=== 7. TUGAGAN o\'yinda amallar bloklanadi ===');
{
  const s = game();
  E.finish(s, 'test');
  t('tugagach kubik tashlab bo\'lmaydi', E.roll(s, 'p0').ok === false);
  t('tugagach navbat yopib bo\'lmaydi', E.endTurn(s, 'p0').ok === false);
  t('tugagach kelishuv yaratib bo\'lmaydi', createDeal(s, 'p0', { to: 'p1', give: { cash: 10 }, receive: {} }).ok === false);
  const before = playerById(s, 'p0').cash;
  E.upgrade(s, 'p0', propTiles[0]);
  t('tugagach yaxshilab bo\'lmaydi', playerById(s, 'p0').cash === before);
}

console.log('\n=== 8. PUL YARATILMASLIGI (kelishuvda) ===');
{
  const s = game();
  const a = playerById(s, 'p0'), b = playerById(s, 'p1');
  a.cash = 100; b.cash = 100;
  const total = a.cash + b.cash;
  const r = createDeal(s, 'p0', { to: 'p1', give: { cash: 100 }, receive: { cash: 100 } });
  if (r.ok) respondDeal(s, 'p1', r.deal.id, true);
  t('kelishuv umumiy pulni o\'zgartirmaydi', a.cash + b.cash === total, `${total} → ${a.cash + b.cash}`);
}

console.log('\n=== 9. KELISHUV: mulk ikki marta va\'da qilinmasin ===');
{
  const s = game();
  const tile = propTiles[1];
  give(s, 'p0', tile);
  const d1 = createDeal(s, 'p0', { to: 'p1', give: { props: [tile] }, receive: {} });
  const d2 = createDeal(s, 'p0', { to: 'p2', give: { props: [tile] }, receive: {} });
  const r1 = d1.ok ? respondDeal(s, 'p1', d1.deal.id, true) : { ok: false };
  const r2 = d2.ok ? respondDeal(s, 'p2', d2.deal.id, true) : { ok: false };
  t('bitta mulk faqat bir marta beriladi', !(r1.ok && r2.ok), `r1=${r1.ok} r2=${r2.ok}`);
  const owners = s.players.filter((p) => p.props.includes(tile));
  t('mulk faqat bitta o\'yinchida', owners.length === 1, `${owners.length} ta egasi`);
}

console.log('\n=== 10. SALBIY / SOXTA KIRISH ===');
{
  const s = game();
  const p = playerById(s, 'p0');
  const before = p.cash;
  t('manfiy naqd taklif qilinmaydi',
    (() => { const r = createDeal(s, 'p0', { to: 'p1', give: { cash: -500 }, receive: {} });
             return !r.ok || r.deal.give.cash >= 0; })());
  t('mavjud bo\'lmagan katak rad etiladi',
    (() => { const r = createDeal(s, 'p0', { to: 'p1', give: { props: [999] }, receive: {} });
             return !r.ok || r.deal.give.props.length === 0; })());
  E.upgrade(s, 'p0', 999);
  E.upgrade(s, 'p0', -5);
  E.sellProperty(s, 'p0', 999);
  t('noto\'g\'ri indeks holatni buzmaydi', p.cash === before && Number.isFinite(p.cash));
  t('o\'zi bilan kelishuv rad etiladi', createDeal(s, 'p0', { to: 'p0', give: { cash: 10 }, receive: {} }).ok === false);
}

console.log('\n=== 11. START MAOSHI aylanish hisobida ===');
{
  const s = game();
  const p = playerById(s, 'p0');
  p.pos = BOARD.length - 1;
  const before = p.cash;
  E.roll(s, 'p0', [1, 1]);              // 2 qadam → START dan o'tadi
  t('aylana yakunlanganda maosh beriladi', p.cash >= before, `${before} → ${p.cash}`);
  t('aylana hisoblandi', p.stats.laps === 1);
}

console.log('\n=== 12. TRANSPORT / KOMMUNAL ijara mantiqi ===');
{
  const s = game();
  const tr = groupTiles('transport');
  const ut = groupTiles('utility');
  const payer = playerById(s, 'p1');
  s.dice = [3, 4];

  give(s, 'p0', tr[0]);
  const rent1 = rentFor(s, tr[0], payer);
  tr.slice(1).forEach((i) => give(s, 'p0', i));
  const rentAll = rentFor(s, tr[0], payer);
  t('transport ijarasi egalik soniga qarab oshadi', rentAll > rent1, `${rent1} → ${rentAll}`);

  give(s, 'p0', ut[0]);
  const u1 = rentFor(s, ut[0], payer);
  ut.slice(1).forEach((i) => give(s, 'p0', i));
  const u2 = rentFor(s, ut[0], payer);
  t('kommunal ijarasi egalik soniga qarab oshadi', u2 > u1, `${u1} → ${u2}`);
  t('kommunal ijarasi kubikka bog\'liq', (() => {
    s.dice = [1, 1]; const low = rentFor(s, ut[0], payer);
    s.dice = [6, 6]; const high = rentFor(s, ut[0], payer);
    return high > low;
  })());
  t('o\'z mulkidan ijara olinmaydi', rentFor(s, tr[0], playerById(s, 'p0')) === 0);
}

console.log('\n=== 13. TUGASH: faqat Host va Net Worth ===');
{
  const s = game();
  const [a, b, c] = s.players;
  a.cash = 1200; a.debt = 1100;
  b.cash = 700; b.debt = 0;
  c.cash = 500; c.debt = 100;
  t('avtomatik tugash yo\'q', E.checkFinish(s) === false && s.status === 'active');
  E.finish(s, 'host');
  t('natijada reyting bor', !!s.result?.ranking?.length);
  t('eng katta Net Worth g\'olib', s.result?.winner?.id === b.id,
    `g'olib=${s.result?.winner?.id}`);
  t('qarz Net Worth dan ayiriladi', netWorth(s, a) === 100, `NW=${netWorth(s, a)}`);
}

console.log('\n=== 14. HODISA: 5 katak va 30 kartalik deck ===');
{
  const eventTiles = BOARD.filter((x) => x.type === 'event');
  t('doskada 5 ta HODISA katagi bor', eventTiles.length === 5, `${eventTiles.length} ta`);
  t('deckda aniq 30 ta karta bor', CARDS.length === 30, `${CARDS.length} ta`);
  t('karta ID lari takrorlanmaydi', new Set(CARDS.map((c) => c.id)).size === 30);
  t('har kartada sarlavha, matn va tone bor',
    CARDS.every((c) => c.title && c.text && ['gain', 'loss', 'strategy'].includes(c.tone)));

  const s = game();
  const p = playerById(s, 'p0');
  p.cash = 10_000;
  const drawn = [];
  for (let i = 0; i < 30; i++) {
    p.pos = 0; s.turnIndex = 0; s.phase = 'idle'; s.pending = null;
    const r = E.roll(s, p.id, [1, 1]);
    if (r.ok && s.lastCard?.id) drawn.push(s.lastCard.id);
  }
  t('bir deck ichida 30 karta takrorsiz chiqadi', drawn.length === 30 && new Set(drawn).size === 30,
    `${new Set(drawn).size}/30 noyob`);
  t('barcha kartalardan keyin pul va qarz yaroqli', Number.isFinite(p.cash) && p.cash >= 0 && Number.isFinite(p.debt) && p.debt >= 0);

  const previous = s.lastCard?.id;
  p.pos = 0; s.turnIndex = 0; s.phase = 'idle';
  E.roll(s, p.id, [1, 1]);
  t('yangi deck avvalgi karta bilan ketma-ket takrorlanmaydi', s.lastCard?.id !== previous);
}

console.log(`\n=== NATIJA: ${pass} ok · ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
