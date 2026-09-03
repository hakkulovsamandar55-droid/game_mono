// Uzoq muddatli yuk testi: haqiqiy server, tasodifiy uzilishlar va qaytishlar
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';
import { RoomManager } from '../src/rooms.js';
import { attachSockets } from '../src/socket.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const app = express(); const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);
attachSockets(io, rooms, { botToken: 't', allowDev: true });
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;

const conn = id => new Promise((res, rej) => {
  const sk = client(`http://localhost:${PORT}`, { auth: { devId: id }, transports: ['websocket'], reconnection: false });
  sk.on('connect', () => res(sk)); sk.on('connect_error', rej);
});
const emit = (sk, ev, p = {}) => new Promise(r => sk.emit(ev, p, r));

let errors = 0, actions = 0;
process.on('uncaughtException', e => { errors++; console.log('UNCAUGHT:', e.message); });
process.on('unhandledRejection', e => { errors++; console.log('UNHANDLED:', e?.message); });

const memStart = process.memoryUsage().heapUsed;
const ROOMS = 8;
for (let r = 0; r < ROOMS; r++) {
  const ids = [`s${r}a`, `s${r}b`, `s${r}c`];
  let socks = [];
  for (const i of ids) socks.push(await conn(i));
  const { code } = await emit(socks[0], 'room:create', { mode: 'multi' });
  for (const sk of socks.slice(1)) await emit(sk, 'room:join', { code });
  await emit(socks[0], 'game:start');

  for (let step = 0; step < 60; step++) {
    const s = rooms.get(code);
    if (!s || s.status === 'finished') break;
    if (s.status === 'active') {
      const cur = s.order[s.turnIndex];
      const idx = ids.findIndex(x => `dev${x}` === cur);
      if (idx >= 0 && socks[idx]?.connected) {
        await emit(socks[idx], 'turn:roll'); actions++;
        await emit(socks[idx], 'prop:buy'); actions++;
        await emit(socks[idx], 'turn:end'); actions++;
      }
    }
    // tasodifiy uzilish / qaytish
    if (step % 7 === 3) {
      const k = step % 3;
      if (socks[k]?.connected) socks[k].disconnect();
      else { socks[k] = await conn(ids[k]); }
      await wait(30);
    }
    // ba'zan grace ni majburlash
    if (step % 11 === 5) {
      const st = rooms.get(code);
      st?.players.forEach(p => { if (p.disconnectedAt) p.disconnectedAt = Date.now() - 60000; });
      rooms.clearAwayTimer(code); rooms.armAwayTurn(code);
      await wait(1100);
    }
  }
  socks.forEach(sk => sk?.connected && sk.disconnect());
}
await wait(1500);
rooms.sweep();
global.gc?.();
const memEnd = process.memoryUsage().heapUsed;

console.log(`\n=== SOAK ===`);
console.log(`amallar: ${actions} · xonalar: ${ROOMS}`);
console.log(`ushlanmagan xatolar: ${errors}`);
console.log(`osilib qolgan timerlar: away=${rooms.awayTimers.size} bot=${rooms.timers.size}`);
console.log(`xotira: ${(memStart/1e6).toFixed(1)} → ${(memEnd/1e6).toFixed(1)} MB`);
const bad = [...rooms.rooms.values()].filter(s => s.status === 'active' && !s.players.some(p => !p.isBot && p.connected));
console.log(`bo'sh lekin faol qolgan xonalar: ${bad.length}`);
server.close(); process.exit(errors ? 1 : 0);
