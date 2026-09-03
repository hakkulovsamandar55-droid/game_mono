import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { initStore, store } from './lib/store.js';
import { RoomManager } from './rooms.js';
import { attachSockets } from './socket.js';
import { BOARD, GROUPS } from './data/board.js';
import { CARDS, ECONOMY_EVENTS } from './data/cards.js';
import { DEFAULTS } from './game/state.js';

const PORT = Number(process.env.PORT || 3000);
const cfg = {
  botToken: process.env.BOT_TOKEN || '',
  allowDev: process.env.ALLOW_DEV_AUTH === '1',
  origin: process.env.CORS_ORIGIN || '*',
};

if (!cfg.allowDev && !cfg.botToken) {
  throw new Error('Production rejimida BOT_TOKEN majburiy');
}

const app = express();
app.use(cors({ origin: cfg.origin }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: cfg.origin }, pingTimeout: 25_000 });

await initStore();
const rooms = new RoomManager(io);
rooms.hydrate();
attachSockets(io, rooms, cfg);

// ---------------- REST ----------------
app.get('/api/health', (req, res) => res.json({
  ok: true, store: store.kind, rooms: rooms.rooms.size, dev: cfg.allowDev, ts: Date.now(),
}));

// mijoz uchun statik ma'lumot (doska, guruhlar, kartalar, iqtisodiy hodisalar)
app.get('/api/reference', (req, res) => res.json({
  board: BOARD,
  groups: GROUPS,
  cards: CARDS.map(({ id, tone, icon, title, text }) => ({ id, tone, icon, title, text })),
  economy: ECONOMY_EVENTS.map(({ id, icon, title, text, mods, upgradeMod }) => ({ id, icon, title, text, mods, upgradeMod })),
  defaults: DEFAULTS,
}));

app.get('/api/room/:code', (req, res) => {
  const s = rooms.get(req.params.code);
  if (!s) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, code: s.code, status: s.status, players: s.players.length, mode: s.mode });
});

// ---------------- statik frontend (ixtiyoriy) ----------------
const publicDir = path.join(process.cwd(), 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} · dev-auth=${cfg.allowDev ? 'on' : 'off'}`);
});
