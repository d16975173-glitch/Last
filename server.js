import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { startBot } from './bot.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const { BOT_TOKEN, JWT_SECRET = 'change-me', PORT = 3000, WEBAPP_URL } = process.env;
if (!BOT_TOKEN) console.warn('BOT_TOKEN не задан: вход через Telegram работать не будет');
if (JWT_SECRET === 'change-me') console.warn('Задай JWT_SECRET в переменных окружения');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dir, 'public')));
app.get('/health', (_, res) => res.send('ok'));

/* ---------- вход через Telegram: проверка подписи initData ---------- */
function checkInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', key).update(str).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(hash || '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

/* ---------- хранилище профилей (файл data.json) ---------- */
const DB_FILE = path.join(__dir, 'data.json');
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
let timer;
const persist = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), (e) => { if (!e) fs.renameSync(DB_FILE + '.tmp', DB_FILE); });
  }, 500);
};

const auth = (req, res, next) => {
  try {
    req.uid = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET).id;
    next();
  } catch { res.sendStatus(401); }
};

app.post('/api/login', (req, res) => {
  const u = checkInitData(req.body && req.body.initData);
  if (!u) return res.sendStatus(401);
  res.json({
    user: { id: u.id, first_name: u.first_name },
    token: jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '30d' }),
  });
});
app.get('/api/profile', auth, (req, res) => res.json(db[req.uid] || {}));
app.put('/api/profile', auth, (req, res) => {
  const { n, a, d } = req.body || {};
  if (!d || typeof d !== 'object') return res.sendStatus(400);
  db[req.uid] = { n: String(n || '').slice(0, 14), a: String(a || '🦊').slice(0, 8), d };
  persist();
  res.sendStatus(204);
});

/* ---------- онлайн-комнаты по WebSocket ---------- */
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();
let nextId = 1;
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
function broadcast(name) {
  const r = rooms.get(name);
  if (!r) return;
  const peers = [...r.values()].map((c) => ({ id: c.id, presence: c.presence }));
  for (const c of r.values()) send(c.ws, { t: 'peers', peers });
}
wss.on('connection', (ws, req) => {
  const name = new URL(req.url, 'http://x').searchParams.get('room') || '';
  if (!/^g[a-z0-9]{4}$/.test(name)) return ws.close();
  if (!rooms.has(name)) rooms.set(name, new Map());
  const room = rooms.get(name);
  if (room.size >= 10) return ws.close();
  const me = { id: nextId++, ws, presence: {} };
  room.set(me.id, me);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  send(ws, { t: 'init', id: me.id });
  broadcast(name);
  ws.on('message', (raw) => {
    if (raw.length > 1024) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t !== 'pres' || !m.p || typeof m.p !== 'object') return;
    for (const [k, v] of Object.entries(m.p)) {
      if (v === null) delete me.presence[k];
      else if (k.length < 8 && JSON.stringify(v).length < 64) me.presence[k] = v;
    }
    broadcast(name);
  });
  ws.on('close', () => {
    room.delete(me.id);
    if (!room.size) rooms.delete(name); else broadcast(name);
  });
});
setInterval(() => wss.clients.forEach((ws) => {
  if (!ws.isAlive) return ws.terminate();
  ws.isAlive = false;
  ws.ping();
}), 30000);

server.listen(PORT, () => console.log('Сервер на порту ' + PORT));
startBot(BOT_TOKEN, WEBAPP_URL).catch((e) => console.error('Ошибка бота', e));
