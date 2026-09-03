/* ==========================================================================
   ECONOMIC VILLAGE — mijoz mantiqi
   Server autoritar: bu yerda hech qanday o'yin qoidasi hisoblanmaydi,
   faqat serverdan kelgan snapshot ko'rsatiladi va amallar yuboriladi.
   ========================================================================== */

const TG = window.Telegram?.WebApp || null;
if (TG) {
  TG.ready(); TG.expand();
  try { TG.setHeaderColor('#F2E8D5'); TG.setBackgroundColor('#F2E8D5'); } catch {}
}
const haptic = (t = 'light') => { try { TG.HapticFeedback.impactOccurred(t); } catch {} };

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('uz-UZ');

/* ---------------- holat ---------------- */
let socket = null;
let ME = null;          // {id, name, avatar}
let S = null;           // oxirgi snapshot
let REF = null;         // /api/reference
let lastCardId = null;
let centerMode = null;  // 'card' | 'economy' | null — markazdagi vaqtinchalik ko'rinish
let dealDraft = null;
let rollingUntil = 0;

const TOKEN_COLORS = ['#B4563A', '#5A7247', '#C08A2E', '#4A6B8A', '#7A4A78'];

/* ---------------- ekranlar ---------------- */
const SCREENS = ['boot', 'home', 'lobby', 'game', 'result'];
function show(name) {
  SCREENS.forEach((s) => $(`scr-${s}`).classList.toggle('on', s === name));
}

function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------- gerb (SVG) ---------------- */
const CREST = `
<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
  <path d="M60 8 106 30v42c0 24-20 36-46 40C34 108 14 96 14 72V30z" fill="#E7D8B8" stroke="#B09468" stroke-width="2"/>
  <path d="M28 74V56l14-11 14 11v18z" fill="#F6EEDC" stroke="#8A6A45" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M38 45l4-16 4 16" stroke="#B4563A" stroke-width="1.8"/>
  <rect x="36" y="62" width="12" height="12" fill="#DCCBAB" stroke="#8A6A45" stroke-width="1.5"/>
  <path d="M62 74V52l16-12 16 12v22z" fill="#F6EEDC" stroke="#8A6A45" stroke-width="1.8" stroke-linejoin="round"/>
  <rect x="70" y="58" width="7" height="7" fill="#DCCBAB" stroke="#8A6A45" stroke-width="1.4"/>
  <rect x="81" y="58" width="7" height="7" fill="#DCCBAB" stroke="#8A6A45" stroke-width="1.4"/>
  <rect x="74" y="66" width="9" height="8" fill="#B4563A" stroke="#8A6A45" stroke-width="1.4"/>
  <path d="M20 82h80" stroke="#5A7247" stroke-width="3" stroke-linecap="round"/>
  <circle cx="34" cy="88" r="4" fill="#5A7247"/><circle cx="60" cy="90" r="5" fill="#5A7247"/><circle cx="86" cy="88" r="4" fill="#5A7247"/>
</svg>`;
['bootCrest', 'homeCrest', 'resultCrest'].forEach((id) => { $(id).innerHTML = CREST; });

/* ---------------- katak ikonlari ----------------
   Bitta stroke, bitta optik og'irlik: doska emoji aralashmasiga emas,
   yaxlit professional ikon tizimiga o'xshaydi.                         */
const icon = (body) => `<svg class="tile-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
const ICON = {
  start: icon('<path d="M4 17V7h10v4h6l-8 8-8-8h6V7"/>'),
  event: icon('<path d="M9.4 9a3 3 0 1 1 4.7 2.5c-1.4.9-2.1 1.6-2.1 3"/><path d="M12 18.2h.01"/>'),
  tax: icon('<path d="M4 9h16M6 9v9m4-9v9m4-9v9m4-9v9M3 19h18M12 4l9 4H3z"/>'),
  square: icon('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 5V3m7 9h2m-9 7v2m-7-9H3"/>'),
  festival: icon('<path d="M5 20V8l7-4 7 4v12M5 10h14M8 7v13m8-13v13"/><path d="M10 14h4"/>'),
  farm: icon('<path d="M4 20c4-1 7-4 8-9 3 1 5 4 4 7"/><path d="M12 11c-2-3-5-4-8-3 0 4 3 7 7 7M12 20V8"/>'),
  shop: icon('<path d="M4 10v10h16V10M3 10l2-6h14l2 6"/><path d="M3 10c1 2 3 2 4 0 1 2 3 2 5 0 1 2 3 2 5 0 1 2 3 2 4 0M9 20v-5h6v5"/>'),
  food: icon('<path d="M7 4v7m-3-7v4c0 2 1 3 3 3s3-1 3-3V4M7 11v9M16 4v16M16 4c4 2 4 7 0 9"/>'),
  transport: icon('<rect x="4" y="5" width="16" height="13" rx="3"/><path d="M4 12h16M8 8h8M7 18v2m10-2v2"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/>'),
  utility: icon('<path d="M13 2 5 14h6l-1 8 9-13h-6z"/>'),
  tourism: icon('<path d="M4 20V8h16v12M8 8V4h8v4M8 12h2m4 0h2m-8 4h2m4 0h2M3 20h18"/>'),
  industry: icon('<path d="M3 20V10l6 3V9l6 3V5h4v15z"/><path d="M7 16h2m4 0h2"/>'),
  finance: icon('<path d="M3 9h18M5 9v9m5-9v9m4-9v9m5-9v9M2 19h20M12 3l10 5H2z"/>'),
};
const glyphFor = (t) => ICON[t.type === 'prop' ? t.group : t.type] || ICON.event;

const SHORT_NAME = {
  "SABZAVOT DO'KONI": 'SABZAVOT', "NON DO'KONI": 'NONVOY',
  'BOZOR MAYDONI': 'BOZOR', 'ELEKTR STANSIYASI': 'ELEKTR',
  "KICHIK DO'KON": "DO'KON", 'SOLIQ IDORASI': 'SOLIQ',
  "YOQILG'I SHOXOBCHASI": "YOQILG'I", 'SUV KOMPANIYASI': 'SUV',
  "DAM OLISH BOG'I": "BOG'", 'FESTIVAL MAYDONI': 'FESTIVAL',
  'MILLIY TAOMLAR': 'TAOMLAR', 'KICHIK ZAVOD': 'ZAVOD',
};
const shortName = (t) => SHORT_NAME[t.name] || t.name;

function boardSide(i) {
  if (i <= 7) return 'bottom';
  if (i <= 14) return 'right';
  if (i <= 21) return 'top';
  return 'left';
}

/* ---------------- doska joylashuvi (8x8 perimetr, 28 katak) ---------------- */
function cellPos(i) {
  if (i === 0) return [8, 1];
  if (i < 7) return [8, 1 + i];
  if (i === 7) return [8, 8];
  if (i < 14) return [8 - (i - 7), 8];
  if (i === 14) return [1, 8];
  if (i < 21) return [1, 8 - (i - 14)];
  if (i === 21) return [1, 1];
  return [1 + (i - 21), 1];
}

/* ---------------- ulanish ---------------- */
function connect() {
  const auth = {};
  if (TG?.initData) auth.initData = TG.initData;
  else auth.devId = localStorage.getItem('devId') || (() => {
    const v = String(Math.floor(Math.random() * 1e6));
    localStorage.setItem('devId', v); return v;
  })();

  socket = io({ auth, transports: ['websocket', 'polling'] });

  socket.on('connect_error', (e) => {
    $('bootMsg').textContent = e.message === 'AUTH_FAILED'
      ? 'Kirish rad etildi. Ilovani Telegram orqali oching.'
      : 'Ulanib bo\'lmadi. Qayta urinilmoqda…';
  });

  socket.on('me', (user) => {
    ME = user;
    $('homeName').textContent = user.name;
    $('meName').textContent = user.name;
    const initial = (user.name || '?').trim()[0]?.toUpperCase() || '?';
    [['homeAvatar', 38], ['meAvatar', 32]].forEach(([id]) => {
      $(id).innerHTML = user.avatar
        ? `<img src="${esc(user.avatar)}" alt="">` : initial;
    });
    if ($('scr-boot').classList.contains('on')) show('home');
  });

  socket.on('session:restored', ({ code, state }) => {
    S = state;
    toast('O\'yinga qaytdingiz');
    renderAll();
  });

  socket.on('state', (state) => { S = state; renderAll(); });

  socket.on('disconnect', () => toast('Aloqa uzildi — qayta ulanmoqda…'));
}

const emit = (ev, payload = {}) => new Promise((res) => socket.emit(ev, payload, res));
async function action(ev, payload) {
  const r = await emit(ev, payload);
  if (r && r.ok === false) toast(r.error || 'Amal bajarilmadi');
  else haptic();
  return r;
}

/* ---------------- render: umumiy ---------------- */
function renderAll() {
  if (!S) return;
  if (S.status === 'lobby') { show('lobby'); renderLobby(); return; }
  if (S.status === 'finished') { show('result'); renderResult(); return; }
  show('game');
  renderHud();
  renderBanner();
  renderBoard();
}

const me = () => S?.players.find((p) => p.id === ME?.id);
const isMyTurn = () => S && S.currentId === ME?.id && S.status === 'active';

/* ---------------- lobby ---------------- */
function renderLobby() {
  $('lobbyCode').textContent = S.code;
  $('lobbyCount').textContent = `${S.players.length}/${S.settings.maxPlayers}`;
  const wrap = $('lobbyPlayers');
  wrap.innerHTML = '';
  S.players.forEach((p, i) => {
    const row = el('div', 'lp');
    row.appendChild(el('div', 'avatar sm', p.avatar
      ? `<img src="${esc(p.avatar)}" alt="">` : esc((p.name || '?')[0])));
    row.appendChild(el('b', null, esc(p.name)));
    if (p.id === S.hostId) row.appendChild(el('span', 'tag host', 'HOST'));
    if (p.isBot) row.appendChild(el('span', 'tag', 'BOT'));
    if (!p.connected && !p.isBot) row.appendChild(el('span', 'tag off', 'OFFLINE'));
    wrap.appendChild(row);
  });

  const isHost = S.hostId === ME?.id;
  const enough = S.players.length >= S.settings.minPlayers;
  $('btnStart').disabled = !isHost || !enough;
  $('btnStart').hidden = !isHost;
  $('lobbyHint').textContent = !enough
    ? `Kamida ${S.settings.minPlayers} o'yinchi kerak — kodni do'stlaringizga yuboring.`
    : (isHost ? 'Hammasi tayyor.' : 'Host boshlashini kuting.');
}

/* ---------------- hud ---------------- */
function renderHud() {
  const m = me();
  $('meCash').textContent = money(m?.cash);
  $('meDebt').textContent = money(m?.debt);
  $('btnDebt').classList.toggle('in-debt', (m?.debt || 0) > 0);
  const pips = $('pips');
  pips.innerHTML = '';
  S.players.forEach((p, i) => {
    const d = el('div', 'pip', esc((p.name || '?')[0].toUpperCase()));
    if (p.id === S.currentId) d.classList.add('on');
    if (!p.alive) d.classList.add('gone');
    if (!p.connected && !p.isBot) d.classList.add('away');
    d.style.borderColor = p.alive ? TOKEN_COLORS[i % 5] : '';
    d.title = p.name;
    pips.appendChild(d);
  });
}

function renderBanner() {
  const b = $('banner');
  const parts = [];

  if (S.autoPaused) parts.push(['dot', 'O\'yin to\'xtatildi', 'Hamma chiqib ketgan edi — kimdir qaytsa davom etadi']);
  else if (S.status === 'paused') parts.push(['dot', 'PAUZA', 'Host o\'yinni to\'xtatdi']);
  else if (me()?.overDebtLimit) parts.push(['dot', 'Qarz limiti oshgan', 'Qarzni kamaytirguncha yangi xarid va qurilish yopiq']);
  else {
    const away = S.players.find((p) => !p.connected && !p.isBot && p.alive && p.id === S.currentId);
    if (away) parts.push(['dot', `${away.name} aloqasi uzildi`, 'Navbat avtomatik o\'tkaziladi']);
  }

  if (!parts.length) { b.hidden = true; return; }
  const [, title, sub] = parts[0];
  b.hidden = false;
  b.innerHTML = `<div class="dot"></div><div><b>${esc(title)}</b><br><span style="font-size:10.5px;color:var(--ink-soft)">${esc(sub)}</span></div>`;
}

/* ---------------- doska ---------------- */
function renderBoard() {
  const board = $('board');
  board.innerHTML = '';
  const tiles = REF?.board || [];

  tiles.forEach((t, i) => {
    const [r, c] = cellPos(i);
    const corner = [0, 7, 14, 21].includes(i);
    const side = boardSide(i);
    const groupClass = t.group ? ` group-${t.group}` : '';
    const cell = el('button', `cell side-${side} type-${t.type}${groupClass}${corner ? ' corner' : ''}`);
    cell.type = 'button';
    cell.setAttribute('aria-label', `${t.name}${t.price ? `, narxi ${t.price}` : ''}`);
    cell.style.gridRow = r; cell.style.gridColumn = c;

    const st = S.tiles?.[i];
    if (t.group) {
      const band = el('div', 'group-band');
      band.innerHTML = `<span>${esc(REF?.groups?.[t.group]?.code || '')}</span>`;
      cell.appendChild(band);
    }
    if (st?.owner) {
      const idx = S.players.findIndex((p) => p.id === st.owner);
      const bar = el('div', 'owned');
      cell.classList.add('is-owned');
      cell.style.setProperty('--owner', TOKEN_COLORS[idx % 5]);
      bar.style.background = TOKEN_COLORS[idx % 5];
      cell.appendChild(bar);
      if (st.level > 0) {
        const levels = el('div', 'lvl');
        for (let l = 1; l <= 3; l++) levels.appendChild(el('i', l <= st.level ? 'built' : ''));
        cell.appendChild(levels);
      }
    }

    cell.appendChild(el('div', 'glyph', glyphFor(t)));
    const copy = el('div', 'tile-copy');
    copy.appendChild(el('div', 'nm', esc(shortName(t))));
    if (t.price) copy.appendChild(el('div', 'pr', money(t.price)));
    if (t.amount) copy.appendChild(el('div', 'pr', `${t.type === 'festival' ? '+' : '−'}${money(t.amount)}`));
    if (t.type === 'event') copy.appendChild(el('div', 'pr event-label', 'KARTA'));
    cell.appendChild(copy);

    const here = S.players.filter((p) => p.alive && p.pos === i);
    if (here.length) {
      const box = el('div', 'tokens');
      here.forEach((p) => {
        const idx = S.players.findIndex((x) => x.id === p.id);
        const d = el('div', 'tok', esc(p.token || (p.name || '?')[0]));
        d.style.setProperty('--token', TOKEN_COLORS[idx % 5]);
        d.title = p.name;
        box.appendChild(d);
      });
      cell.appendChild(box);
    }
    if (me()?.pos === i) cell.classList.add('here');
    cell.onclick = () => openTile(i);
    board.appendChild(cell);
  });

  board.appendChild(renderCenter());
}

/* ---------------- markaz — kontekstga qarab o'zgaradi ---------------- */
function renderCenter() {
  const c = el('div', 'center');
  const m = me();

  // 1) karta chiqdi
  if (centerMode === 'card' && S.lastCard) {
    const tone = ['gain', 'loss', 'strategy'].includes(S.lastCard.tone) ? S.lastCard.tone : 'strategy';
    c.classList.add('card-view', `card-${tone}`);
    if (S.dice?.length) {
      const pair = el('div', 'dice-pair');
      S.dice.forEach((d) => pair.appendChild(el('div', 'die sm', d)));
      c.appendChild(pair);
    }
    c.appendChild(el('div', 'event-mark', ICON.event));
    c.appendChild(el('div', 'c-kicker', `HODISA KARTASI · ${REF?.cards?.length || 30} KARTA`));
    c.appendChild(el('div', 'c-title', esc(S.lastCard.title)));
    c.appendChild(el('div', 'c-text', esc(S.lastCard.text)));
    const b = el('button', 'mini', 'DAVOM');
    b.onclick = () => { centerMode = null; renderBoard(); };
    c.appendChild(b);
    return c;
  }

  // 2) iqtisodiy hodisa
  if (centerMode === 'economy' && S.economy?.current) {
    const e = S.economy.current;
    c.appendChild(el('div', 'c-kicker', 'IQTISODIY HODISA'));
    c.appendChild(el('div', 'c-title', esc(e.title)));
    c.appendChild(el('div', 'c-text', esc(e.text)));
    const rows = el('div', 'eff-row');
    Object.entries(e.mods || {}).forEach(([g, v]) => {
      const up = v > 1;
      rows.appendChild(el('div', 'eff',
        `<span>${esc(REF?.groups?.[g]?.name || g)}</span><b class="${up ? 'up' : 'down'}">${up ? '+' : ''}${Math.round((v - 1) * 100)}%</b>`));
    });
    c.appendChild(rows);
    const b = el('button', 'mini', 'DAVOM');
    b.onclick = () => { centerMode = null; renderBoard(); };
    c.appendChild(b);
    return c;
  }

  // 3) pauza
  if (S.status === 'paused') {
    c.appendChild(el('div', 'c-kicker', 'PAUZA'));
    c.appendChild(el('div', 'c-text', S.autoPaused
      ? 'Hamma chiqib ketgan edi. Kimdir qaytsa o\'yin davom etadi.'
      : 'Host o\'yinni to\'xtatdi.'));
    if (S.hostId === ME?.id) {
      const b = el('button', 'roll-btn', 'DAVOM ETTIRISH');
      b.onclick = () => action('game:resume');
      c.appendChild(b);
    }
    return c;
  }

  // 4) xarid taklifi
  if (S.pending && S.pending.player === ME?.id) {
    const t = REF.board[S.pending.tile];
    // Kubik natijasi shu yerda ham ko'rinishi kerak — aks holda o'yinchi
    // nima tashlaganini bilmay qoladi.
    if (S.dice?.length) {
      const pair = el('div', 'dice-pair');
      S.dice.forEach((d) => pair.appendChild(el('div', 'die sm', d)));
      c.appendChild(pair);
    }
    c.appendChild(el('div', 'c-title', esc(t.name)));
    c.appendChild(el('div', 'c-text', `Narx ${money(S.pending.price)} · Ijara ${money(t.rent?.[0] ?? 0)}`));
    const row = el('div', 'mini-row');
    const buy = el('button', 'mini go', `SOTIB OLISH ${money(S.pending.price)}`);
    buy.disabled = (m?.cash ?? 0) < S.pending.price || !!m?.overDebtLimit;
    buy.onclick = () => action('prop:buy');
    const skip = el('button', 'mini', 'O\'TKAZISH');
    skip.onclick = () => action('prop:skip');
    row.append(buy, skip);
    c.appendChild(row);
    return c;
  }

  // 6) mening navbatim
  if (isMyTurn()) {
    if (S.phase === 'idle') {
      c.appendChild(el('div', 'c-kicker', 'SIZNING NAVBATINGIZ'));
      const die = el('div', 'die', '?');
      c.appendChild(die);
      const b = el('button', 'roll-btn', 'TASHLASH');
      b.onclick = async () => {
        die.classList.add('rolling');
        rollingUntil = Date.now() + 500;
        await action('turn:roll');
      };
      c.appendChild(b);
      return c;
    }
    // tashlangan / hal qilingan
    const pair = el('div', 'dice-pair');
    (S.dice || [0, 0]).forEach((d) => pair.appendChild(el('div', 'die sm', d)));
    c.appendChild(pair);
    const t = REF.board[m.pos];
    c.appendChild(el('div', 'c-title', esc(t.name)));
    const b = el('button', 'roll-btn', 'NAVBATNI YAKUNLASH');
    b.onclick = () => action('turn:end');
    c.appendChild(b);
    return c;
  }

  // 7) boshqaning navbati
  const cur = S.players.find((p) => p.id === S.currentId);
  c.appendChild(el('div', 'c-sub', `${S.round}-raund`));
  c.appendChild(el('div', 'c-brand', 'ECONOMIC<em>VILLAGE</em>'));
  c.appendChild(el('div', 'c-sub', cur ? `${esc(cur.name)} o'ylamoqda…` : ''));
  if (S.dice?.length) {
    const pair = el('div', 'dice-pair');
    S.dice.forEach((d) => pair.appendChild(el('div', 'die sm', d)));
    c.appendChild(pair);
  }
  return c;
}

/* ---------------- sheet ---------------- */
function openSheet(html) {
  $('sheetBody').innerHTML = html;
  $('sheet').hidden = false;
  $('scrim').hidden = false;
}
function closeSheet() { $('sheet').hidden = true; $('scrim').hidden = true; }
$('scrim').onclick = closeSheet;

function openTile(i) {
  const t = REF.board[i];
  const st = S?.tiles?.[i];
  if (!t) return;
  const owner = st?.owner ? S.players.find((p) => p.id === st.owner) : null;
  const ownerIdx = owner ? S.players.findIndex((p) => p.id === owner.id) : -1;
  const g = t.group ? REF.groups[t.group] : null;

  let rows = '';
  if (t.type === 'prop') {
    const lvl = st?.level || 0;
    rows += `<div class="kv"><span>Narx</span><b>${money(t.price)}</b></div>`;
    if (t.rent?.some((x) => x > 0)) {
      rows += `<div class="kv"><span>Ijara (hozirgi daraja)</span><b>${money(st?.rent ?? t.rent[lvl] ?? t.rent[0])}</b></div>`;
    }
    if (t.upgrade) rows += `<div class="kv"><span>Yaxshilash</span><b>${money(st?.upCost ?? t.upgrade)}</b></div>`;
    rows += `<div class="kv"><span>Daraja</span><b>${lvl} / 3</b></div>`;
  } else if (t.amount) {
    rows += `<div class="kv"><span>Miqdor</span><b>${money(t.amount)}</b></div>`;
  }
  if (t.note) rows += `<div class="kv"><span>${esc(t.note)}</span><b></b></div>`;

  const ownerRow = owner
    ? `<div class="owner-row"><div class="owner-dot" style="background:${TOKEN_COLORS[ownerIdx % 5]}"></div>
       <span>Egasi</span><b style="margin-left:auto">${esc(owner.name)}</b></div>`
    : (t.type === 'prop' ? '<div class="owner-row"><span>Egasiz</span></div>' : '');

  const canUp = owner?.id === ME?.id && t.upgrade > 0 && (st?.level || 0) < 3 && !me()?.overDebtLimit;
  const actions = canUp
    ? `<div class="row2">
         <button class="btn" onclick="EV.upgrade(${i})">YAXSHILASH ${money(st?.upCost ?? t.upgrade)}</button>
       </div>` : '';

  openSheet(`
    <div class="sheet-head">
      <div class="sheet-thumb">${glyphFor(t)}</div>
      <div><h3>${esc(t.name)}</h3>
        ${g ? `<span class="tag">${esc(g.name)}</span>` : ''}</div>
    </div>
    ${g ? `<div class="hint" style="text-align:left;margin-bottom:8px">${esc(g.trait)}</div>` : ''}
    ${rows}${ownerRow}${actions}
    <button class="btn ghost" onclick="EV.close()">YOPISH</button>
  `);
}

/* ---------------- panellar ---------------- */
function panelAssets() {
  const m = me();
  const mine = (m?.props || []).map((i) => {
    const t = REF.board[i]; const st = S.tiles[i];
    return `<div class="list-item">
      <div class="sheet-thumb" style="width:34px;height:34px;border-radius:10px;font-size:16px">${glyphFor(t)}</div>
      <div class="grow"><b>${esc(t.name)}</b><small>Daraja ${st.level}/3 · ijara ${money(st.rent ?? 0)}</small></div>
      ${t.upgrade && st.level < 3 && !m?.overDebtLimit
        ? `<button class="mini" onclick="EV.upgrade(${i})">+${money(st.upCost)}</button>` : ''}
    </div>`;
  }).join('');

  openSheet(`<h3>Mulklarim</h3>
    ${debtSummary(m)}
    ${mine || '<div class="hint">Hali mulkingiz yo\'q.</div>'}
    <button class="btn ghost" onclick="EV.close()">YOPISH</button>`);
}

function debtSummary(m = me()) {
  const debt = m?.debt || 0;
  const limit = m?.debtLimit || 0;
  const pct = limit > 0 ? Math.min(100, Math.round(debt / limit * 100)) : 0;
  const form = debt > 0 && (m?.cash || 0) > 0
    ? `<div class="row2"><input class="cash-input" id="debtAmount" type="number" min="1" max="${Math.min(m.cash, debt)}" value="${Math.min(m.cash, debt)}">
       <button class="btn primary" onclick="EV.repayDebt()">TO'LASH</button></div>` : '';
  return `<div class="debt-card ${debt ? '' : 'safe'}">
    <div class="kv"><span>Sof qiymat</span><b>${money(m?.netWorth)}</b></div>
    <div class="kv"><span>Naqd pul</span><b>${money(m?.cash)}</b></div>
    <div class="kv"><span>Qarz / yumshoq limit</span><b>${money(debt)} / ${money(limit)}</b></div>
    <div class="debt-meter"><span style="width:${pct}%"></span></div>
    <div class="hint" style="text-align:left;margin:0">${m?.overDebtLimit
      ? 'Limit oshgan: yangi xarid va qurilish qarz kamayguncha yopiq.'
      : (debt ? 'Daromadning 25% qismi qarzni avtomatik yopadi.' : 'Qarz yo\'q — moliyaviy holat barqaror.')}</div>
    ${form}
  </div>`;
}

function panelDebt() {
  openSheet(`<h3>Moliya</h3>${debtSummary(me())}
    <div class="hint" style="text-align:left">Majburiy to'lovga naqd pul yetmasa farq kreditga o'tadi. Har 3-raundda 3% foiz qo'shiladi; qarz Net Worth'dan ayiriladi.</div>
    <button class="btn ghost" onclick="EV.close()">YOPISH</button>`);
}

function panelEconomy() {
  const e = S.economy?.current;
  const hist = (S.economy?.history || []).slice(0, 6)
    .map((h) => `<div class="log-line">${esc(h.title)}</div>`).join('');
  const groups = Object.values(REF.groups)
    .map((g) => `<div class="list-item"><div class="grow"><b>${esc(g.name)}</b><small>${esc(g.trait)}</small></div><span class="tag">${g.code}</span></div>`)
    .join('');
  openSheet(`<h3>Iqtisodiyot</h3>
    ${e ? `<div class="list-item"><div class="grow"><b>${esc(e.title)}</b><small>${esc(e.text)}</small></div></div>`
        : '<div class="hint">Hozir maxsus iqtisodiy holat yo\'q.</div>'}
    <div class="sec-title">Guruhlar</div>${groups}
    ${hist ? `<div class="sec-title">Oldingi hodisalar</div>${hist}` : ''}
    <button class="btn ghost" onclick="EV.close()">YOPISH</button>`);
}

function panelLog() {
  const lines = (S.log || []).slice(0, 40)
    .map((l) => `<div class="log-line">${esc(l.icon || '')} ${esc(l.text)}</div>`).join('');
  openSheet(`<h3>Tarix</h3>${lines || '<div class="hint">Bo\'sh.</div>'}
    <button class="btn ghost" onclick="EV.close()">YOPISH</button>`);
}

/* ---------------- kelishuv ---------------- */
function panelDeal() {
  const incoming = (S.deals || []).filter((d) => d.to === ME?.id && d.status === 'pending');
  if (incoming.length) return dealIncoming(incoming[0]);

  const others = S.players.filter((p) => p.id !== ME?.id && p.alive);
  if (!others.length) return openSheet('<h3>Kelishuv</h3><div class="hint">Hozir kelishuv qiladigan o\'yinchi yo\'q.</div><button class="btn ghost" onclick="EV.close()">YOPISH</button>');

  if (!dealDraft) dealDraft = { to: others[0].id, giveCash: 0, getCash: 0, give: [], receive: [] };
  dealBuilder();
}

function dealBuilder() {
  const m = me();
  const others = S.players.filter((p) => p.id !== ME?.id && p.alive);
  const target = S.players.find((p) => p.id === dealDraft.to) || others[0];
  dealDraft.to = target.id;

  const chips = (props, sel, kind) => props.map((i) => {
    const t = REF.board[i];
    return `<button class="${sel.includes(i) ? 'sel' : ''}" onclick="EV.dealToggle('${kind}',${i})">${esc(t.name)}</button>`;
  }).join('') || '<span class="hint">mulk yo\'q</span>';

  openSheet(`<h3>Kelishuv</h3>
    <div class="deal-col">
      <h4>KIM BILAN</h4>
      <div class="chipsel">${others.map((p) => `<button class="${p.id === target.id ? 'sel' : ''}" onclick="EV.dealTarget('${p.id}')">${esc(p.name)}</button>`).join('')}</div>
    </div>
    <div class="deal-col">
      <h4>SIZ BERASIZ</h4>
      <div class="chipsel">${chips(m.props || [], dealDraft.give, 'give')}</div>
      <input class="cash-input" type="number" min="0" max="${m.cash}" value="${dealDraft.giveCash}"
             oninput="EV.dealCash('give',this.value)" placeholder="naqd">
    </div>
    <div class="swap">ALMASHASIZ</div>
    <div class="deal-col">
      <h4>${esc(target.name).toUpperCase()} BERADI</h4>
      <div class="chipsel">${chips(target.props || [], dealDraft.receive, 'receive')}</div>
      <input class="cash-input" type="number" min="0" max="${target.cash}" value="${dealDraft.getCash}"
             oninput="EV.dealCash('get',this.value)" placeholder="naqd">
    </div>
    <button class="btn primary" onclick="EV.dealSend()">TAKLIF YUBORISH</button>
    <button class="btn ghost" onclick="EV.close()">BEKOR</button>`);
}

function dealIncoming(d) {
  const from = S.players.find((p) => p.id === d.from);
  const list = (arr) => (arr || []).map((i) => esc(REF.board[i].name)).join(', ') || '—';
  openSheet(`<h3>Taklif: ${esc(from?.name)}</h3>
    <div class="deal-col"><h4>SIZGA BERADI</h4>
      <div class="hint" style="text-align:left">${list(d.give?.props)}${d.give?.cash ? ` · ${money(d.give.cash)} naqd` : ''}</div></div>
    <div class="swap">EVAZIGA</div>
    <div class="deal-col"><h4>SIZDAN SO'RAYDI</h4>
      <div class="hint" style="text-align:left">${list(d.receive?.props)}${d.receive?.cash ? ` · ${money(d.receive.cash)} naqd` : ''}</div></div>
    <div class="row2">
      <button class="btn primary" onclick="EV.dealRespond('${d.id}',true)">QABUL</button>
      <button class="btn" onclick="EV.dealRespond('${d.id}',false)">RAD</button>
    </div>`);
}

/* ---------------- menyu / qoidalar ---------------- */
function panelMenu() {
  const isHost = S.hostId === ME?.id;
  openSheet(`<h3>Menyu</h3>
    <div class="hint" style="text-align:left">Xona kodi: <b>${esc(S.code)}</b></div>
    ${isHost && S.status === 'active' ? '<button class="btn" onclick="EV.act(\'game:pause\')">PAUZA</button>' : ''}
    ${isHost && S.status === 'paused' ? '<button class="btn primary" onclick="EV.act(\'game:resume\')">DAVOM</button>' : ''}
    <button class="btn" onclick="EV.rules()">QOIDALAR</button>
    ${isHost ? '<button class="btn" onclick="EV.endGame()">O\'YINNI TUGATISH</button>' : ''}
    <button class="btn ghost" onclick="EV.leave()">XONADAN CHIQISH</button>`);
}

function panelRules() {
  const d = REF?.defaults || {};
  openSheet(`<h3>Qoidalar</h3>
    <div class="kv"><span>Boshlang'ich pul</span><b>${money(d.startCash)}</b></div>
    <div class="kv"><span>Aylana maoshi</span><b>${money(d.salary)}</b></div>
    <div class="kv"><span>O'yinchilar</span><b>${d.minPlayers}–${d.maxPlayers}</b></div>
    <div class="sec-title">Qanday yutiladi</div>
    <div class="hint" style="text-align:left">
      Vaqt va raund chegarasi yo'q. Host tanaffusda o'yinni pauza qiladi va
      kelishilgan paytda yakunlaydi. Eng katta sof qiymat egasi g'olib.
    </div>
    <div class="sec-title">Qarz va kredit</div>
    <div class="hint" style="text-align:left">
      Majburiy to'lovga pul yetmasa farq qarzga o'tadi — hech kim o'yindan
      chiqarilmaydi. Daromadning ${Math.round((d.debtAutoRepayRate || 0) * 100)}% qismi avtomatik qarzni yopadi;
      har ${d.debtInterestEvery}-raundda ${Math.round((d.debtInterestRate || 0) * 100)}% foiz qo'shiladi.
      Sof qiymat = naqd pul + mulk va binolar − qarz.
    </div>
    <div class="sec-title">Guruh bonusi</div>
    <div class="hint" style="text-align:left">Bir guruhning barcha mulklarini yig'sangiz ijara ikki barobar bo'ladi — shuning uchun kelishuv muhim.</div>
    <button class="btn ghost" onclick="EV.close()">YOPISH</button>`);
}

/* ---------------- natija ---------------- */
function renderResult() {
  const rank = S.result?.ranking || [];
  $('resultList').innerHTML = rank.map((r, i) => `
    <div class="res-row ${i === 0 ? 'win' : ''}">
      <div class="res-rank">${i + 1}</div>
      <div class="grow"><b>${esc(r.name)}</b><small>${r.props} mulk · ${money(r.cash)} naqd · ${money(r.debt)} qarz</small></div>
      <div class="res-nw">${money(r.netWorth)}</div>
    </div>`).join('');

  const h = S.result?.highlights || {};
  const line = (label, v) => (v ? `<div class="kv"><span>${label}</span><b>${esc(v)}</b></div>` : '');
  $('resultStats').innerHTML =
    line("Eng katta ijara", h.topRent && `${h.topRent.name} · ${money(h.topRent.value)}`) +
    line("Eng yaxshi kelishuv", h.bestDeal && `${h.bestDeal.name} · ${money(h.bestDeal.value)}`) +
    line("Eng ko'p mulk", h.mostProps) +
    line("Iqtisodiy hodisalar", h.events) +
    line("Jami raund", S.result?.round);
}

/* ---------------- global harakatlar (HTML onclick uchun) ---------------- */
window.EV = {
  close: closeSheet,
  act: (ev) => { closeSheet(); action(ev); },
  upgrade: (i) => { closeSheet(); action('prop:upgrade', { tile: i }); },
  rules: panelRules,
  endGame: () => openSheet(`<h3>O'yinni yakunlash</h3>
    <div class="hint" style="text-align:left">Natija hozirgi Net Worth bo'yicha hisoblanadi. Tanaffus qilmoqchi bo'lsangiz PAUZA ni tanlang.</div>
    <button class="btn primary" onclick="EV.confirmEndGame()">YAKUNLASH</button>
    <button class="btn ghost" onclick="EV.close()">BEKOR</button>`),
  confirmEndGame: () => { closeSheet(); action('game:end'); },
  leave: async () => { closeSheet(); await action('room:leave'); S = null; show('home'); },
  dealTarget: (id) => { dealDraft.to = id; dealDraft.give = []; dealDraft.receive = []; dealBuilder(); },
  dealToggle: (kind, i) => {
    const arr = dealDraft[kind];
    const at = arr.indexOf(i);
    if (at >= 0) arr.splice(at, 1); else arr.push(i);
    dealBuilder();
  },
  dealCash: (kind, v) => { dealDraft[kind === 'give' ? 'giveCash' : 'getCash'] = Math.max(0, Number(v) || 0); },
  dealSend: async () => {
    const d = dealDraft;
    const r = await action('deal:create', {
      to: d.to,
      give: { cash: d.giveCash, props: d.give },
      receive: { cash: d.getCash, props: d.receive },
    });
    if (r?.ok !== false) { dealDraft = null; closeSheet(); toast('Taklif yuborildi'); }
  },
  dealRespond: async (id, accept) => { closeSheet(); await action('deal:respond', { id, accept }); },
  repayDebt: async () => {
    const amount = Number($('debtAmount')?.value || 0);
    const r = await action('debt:repay', { amount });
    if (r?.ok !== false) { closeSheet(); toast(`Qarzdan ${money(r.repaid)} to'landi`); }
  },
};

/* ---------------- hodisalar ---------------- */
$('btnCreate').onclick = async () => {
  const r = await emit('room:create', { mode: 'multi' });
  if (r?.ok === false) return toast(r.error);
};
$('btnTutorial').onclick = async () => {
  const r = await emit('room:create', { mode: 'tutorial' });
  if (r?.ok === false) return toast(r.error);
};
$('btnJoin').onclick = () => {
  openSheet(`<h3>O'yinga qo'shilish</h3>
    <input class="cash-input" id="joinCode" placeholder="XONA KODI" maxlength="6"
           style="text-transform:uppercase;letter-spacing:5px;text-align:center;font-size:20px">
    <button class="btn primary" onclick="EV.doJoin()">QO'SHILISH</button>
    <button class="btn ghost" onclick="EV.close()">BEKOR</button>`);
};
window.EV.doJoin = async () => {
  const code = ($('joinCode').value || '').trim().toUpperCase();
  if (!code) return;
  const r = await emit('room:join', { code });
  if (r?.ok === false) return toast(r.error);
  closeSheet();
};
$('btnStart').onclick = () => action('game:start');
$('btnLeave').onclick = () => window.EV.leave();
$('btnLobbyBack').onclick = () => window.EV.leave();
$('btnCopy').onclick = () => {
  navigator.clipboard?.writeText(S.code);
  toast('Kod nusxalandi');
};
$('btnInvite').onclick = () => {
  const url = `https://t.me/share/url?url=${encodeURIComponent(location.origin)}&text=${encodeURIComponent(`Economic Village — xona kodi: ${S.code}`)}`;
  if (TG?.openTelegramLink) TG.openTelegramLink(url); else window.open(url, '_blank');
};
$('btnMenu').onclick = panelMenu;
$('btnDebt').onclick = panelDebt;
$('btnRules').onclick = panelRules;
$('btnInfoHome').onclick = panelRules;
$('btnProfile').onclick = () => openSheet(`<h3>${esc(ME?.name || '')}</h3>
  <div class="hint" style="text-align:left">Statistika keyingi versiyada qo'shiladi.</div>
  <button class="btn ghost" onclick="EV.close()">YOPISH</button>`);
$('btnHome').onclick = () => { S = null; show('home'); };

document.querySelectorAll('.dock button').forEach((b) => {
  b.onclick = () => ({
    assets: panelAssets, deal: panelDeal, economy: panelEconomy, log: panelLog,
  }[b.dataset.panel]?.());
});

/* karta va iqtisodiy hodisa paydo bo'lganda markazni almashtirish */
function watchEvents(prev, next) {
  if (next.lastCard && next.lastCard.id !== lastCardId) {
    lastCardId = next.lastCard.id;
    if (next.lastCard.player === ME?.id) centerMode = 'card';
  }
  const pe = prev?.economy?.current?.id, ne = next.economy?.current?.id;
  if (ne && ne !== pe) centerMode = 'economy';
}
const origRenderAll = renderAll;
let prevSnapshot = null;
renderAll = function () {
  if (S) { watchEvents(prevSnapshot, S); prevSnapshot = S; }
  origRenderAll();
};

/* ---------------- start ---------------- */
(async function boot() {
  try {
    REF = await (await fetch('/api/reference')).json();
  } catch {
    $('bootMsg').textContent = 'Server javob bermadi.';
    return;
  }
  connect();
})();
