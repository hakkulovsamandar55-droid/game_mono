// ============================================================================
// STORE — o'yin holatini doimiy saqlash.
// Asosiy: SQLite (better-sqlite3). Agar modul yo'q bo'lsa — JSON fayl.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

let impl = null;

async function initSqlite() {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path.join(DATA_DIR, 'village.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    status TEXT,
    updated_at INTEGER
  )`);
  const up = db.prepare('INSERT INTO rooms (code,state,status,updated_at) VALUES (?,?,?,?) ' +
    'ON CONFLICT(code) DO UPDATE SET state=excluded.state, status=excluded.status, updated_at=excluded.updated_at');
  return {
    kind: 'sqlite',
    save: (s) => up.run(s.code, JSON.stringify(s), s.status, Date.now()),
    load: (code) => {
      const row = db.prepare('SELECT state FROM rooms WHERE code=?').get(code);
      return row ? JSON.parse(row.state) : null;
    },
    all: () => db.prepare('SELECT state FROM rooms WHERE status != ? ORDER BY updated_at DESC LIMIT 200')
      .all('finished').map((r) => JSON.parse(r.state)),
    remove: (code) => db.prepare('DELETE FROM rooms WHERE code=?').run(code),
    prune: (olderThanMs) => db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(Date.now() - olderThanMs),
  };
}

function initJson() {
  const dir = path.join(DATA_DIR, 'rooms');
  fs.mkdirSync(dir, { recursive: true });
  const file = (code) => path.join(dir, `${code}.json`);
  return {
    kind: 'json',
    save: (s) => fs.writeFileSync(file(s.code), JSON.stringify(s)),
    load: (code) => (fs.existsSync(file(code)) ? JSON.parse(fs.readFileSync(file(code), 'utf8')) : null),
    all: () => fs.readdirSync(dir).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
    }).filter((s) => s && s.status !== 'finished'),
    remove: (code) => { if (fs.existsSync(file(code))) fs.unlinkSync(file(code)); },
    prune: (olderThanMs) => {
      const cut = Date.now() - olderThanMs;
      fs.readdirSync(dir).forEach((f) => {
        const p = path.join(dir, f);
        if (fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p);
      });
    },
  };
}

export async function initStore() {
  try {
    impl = await initSqlite();
  } catch (e) {
    impl = initJson();
    console.warn('[store] SQLite mavjud emas, JSON saqlash ishlatilmoqda:', e.message);
  }
  console.log(`[store] ${impl.kind} · ${DATA_DIR}`);
  return impl;
}

export const store = {
  save: (s) => impl?.save(s),
  load: (code) => impl?.load(code) ?? null,
  all: () => impl?.all() ?? [],
  remove: (code) => impl?.remove(code),
  prune: (ms) => impl?.prune(ms),
  get kind() { return impl?.kind; },
};
