// ============================================================================
// ECONOMIC VILLAGE — doska
// 28 katak: 4 burchak + 19 biznes + 5 hodisa qutisi.
// Burchaklar: 0, 7, 14, 21 (8x8 perimetr uchun majburiy)
// ============================================================================

export const GROUPS = {
  farm:      { key: 'farm',      name: "DEHQONCHILIK", code: 'A', trait: "Arzon · barqaror daromad" },
  shop:      { key: 'shop',      name: "DO'KONLAR",    code: 'B', trait: "Arzon · o'rtacha daromad" },
  food:      { key: 'food',      name: "OVQATLANISH",  code: 'C', trait: "O'rta investitsiya · o'rta daromad" },
  transport: { key: 'transport', name: "TRANSPORT",    code: 'D', trait: "Ijara egalik soniga bog'liq" },
  utility:   { key: 'utility',   name: "KOMMUNAL",     code: 'E', trait: "Ijara kubik natijasiga bog'liq" },
  tourism:   { key: 'tourism',   name: "TURIZM",       code: 'F', trait: "Qimmat · yuqori daromad · xavfli" },
  industry:  { key: 'industry',  name: "SANOAT",       code: 'G', trait: "Qimmat · barqaror yuqori daromad" },
  finance:   { key: 'finance',   name: "MOLIYA",       code: 'H', trait: "Ijara egasining mulk soniga bog'liq" },
};

const P = (name, group, price, rent, upgrade) => ({ type: 'prop', name, group, price, rent, upgrade });

export const BOARD = [
  { type: 'start',    name: "START",            note: "Har aylanada maosh" },
  P("SABZAVOT DO'KONI", 'farm',      60,  [7, 20, 45, 80],     40),
  { type: 'event',    name: "HODISA" },
  P("FERMA",            'farm',      70,  [8, 24, 52, 92],     45),
  P("NON DO'KONI",      'shop',      90,  [10, 30, 70, 125],   55),
  P("AVTOBEKAT",        'transport', 140, [0, 45, 110, 110],   0),
  P("SARTAROSHXONA",    'shop',      100, [11, 33, 78, 140],   60),
  { type: 'square',   name: "BOZOR MAYDONI",    note: "Dam olish — hech narsa bo'lmaydi" },
  P("CHOYXONA",         'food',      120, [13, 40, 95, 170],   70),
  P("ELEKTR STANSIYASI",'utility',   130, [0, 0, 0, 0],        0),
  P("KICHIK DO'KON",    'shop',      110, [12, 36, 85, 150],   65),
  { type: 'event',    name: "HODISA" },
  P("RESTORAN",         'food',      150, [17, 50, 120, 215],  85),
  P("USTAXONA",         'industry',  180, [20, 60, 140, 255],  100),
  { type: 'tax',      name: "SOLIQ IDORASI",    amount: 150, note: "Qat'iy soliq" },
  P("MEHMON UYI",       'tourism',   180, [20, 62, 145, 265],  100),
  { type: 'event',    name: "HODISA" },
  P("YOQILG'I SHOXOBCHASI", 'transport', 140, [0, 45, 110, 110], 0),
  P("MEHMONXONA",       'tourism',   220, [26, 78, 180, 330],  120),
  P("SUV KOMPANIYASI",  'utility',   130, [0, 0, 0, 0],        0),
  P("OMBORXONA",        'industry',  200, [23, 68, 160, 290],  110),
  { type: 'festival', name: "FESTIVAL MAYDONI", amount: 120, note: "Qishloq granti" },
  P("DAM OLISH BOG'I",  'tourism',   240, [28, 85, 200, 360],  130),
  { type: 'event',    name: "HODISA" },
  P("KICHIK ZAVOD",     'industry',  260, [30, 90, 210, 380],  140),
  P("MILLIY TAOMLAR",   'food',      160, [18, 54, 128, 230],  90),
  { type: 'event',    name: "HODISA" },
  P("BANK",             'finance',   300, [0, 0, 0, 0],        0),
].map((t, i) => ({ ...t, i }));

export const BOARD_SIZE = BOARD.length; // 28
export const CORNERS = [0, 7, 14, 21];

// transport ijarasi: nechta transport mulki bo'lsa
export const TRANSPORT_RENT = [0, 45, 110];
// kommunal: kubik yig'indisi * koeffitsient
export const UTILITY_MULT = [0, 6, 12];
// bank: egasining har bir mulki uchun
export const BANK_PER_PROPERTY = 30;

export const MAX_LEVEL = 3;
export const LEVEL_NAME = ["Oddiy", "Yaxshilangan", "Kengaytirilgan", "Premium"];

export function groupTiles(groupKey) {
  return BOARD.filter((t) => t.group === groupKey).map((t) => t.i);
}

export function isBuyable(tile) {
  return tile.type === 'prop';
}

export function canUpgrade(tile) {
  return tile.type === 'prop' && tile.upgrade > 0;
}
