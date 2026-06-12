const http = require('http');
const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT      = process.env.PORT || 8799;
const HTML_FILE = path.join(__dirname, 'dashboard.html');

// ─── Shared state (lives in memory — refreshes on server restart) ─────────────
let collabState = null; // initialised by first client that calls push_state

// ─── User tracking ─────────────────────────────────────────────────────────────
const clients = new Map(); // ws → {id, color, name, alive}
let nextId = 1;

const COLORS = ['#2563EB','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#C026D3'];
const NAMES  = ['Аналитик','Маркетолог','Директор','Менеджер','Стратег','Консультант','Эксперт'];

// ─── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }

  // Health check
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, {'Content-Type':'text/plain'});
    res.end('ok');
    return;
  }

  // Serve dashboard for every other path
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end(html);
});

// ─── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const id    = nextId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const name  = NAMES[(id - 1)  % NAMES.length] + ' ' + id;
  clients.set(ws, { id, color, name, alive: true });

  // Welcome: send identity + current shared state
  send(ws, { type: 'welcome', me: { id, color, name }, state: collabState, users: getUsers() });
  // Tell everyone else about the new user
  broadcast({ type: 'users', users: getUsers() }, ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const user = clients.get(ws);

      if (msg.type === 'push_state' && !collabState) {
        collabState = msg.state;
      }

      if (msg.type === 'state_restore') {
        collabState = msg.state;
        broadcast({ type: 'state_restore', state: msg.state, userId: user?.id }, ws);
      }

      if (msg.type === 'edit') {
        if (collabState?.[msg.brand]) {
          collabState[msg.brand][msg.ri][msg.field] = msg.value;
        }
        broadcast({ type: 'edit', brand: msg.brand, ri: msg.ri, field: msg.field, value: msg.value, userId: user?.id }, ws);
      }

      if (msg.type === 'focus') {
        broadcast({ type: 'focus', brand: msg.brand, ri: msg.ri, field: msg.field, user }, ws);
      }

      if (msg.type === 'blur') {
        broadcast({ type: 'blur', brand: msg.brand, ri: msg.ri, field: msg.field, userId: user?.id }, ws);
      }

      if (msg.type === 'add_forecast_row') {
        if (collabState?.[msg.brand]) collabState[msg.brand].push(msg.row);
        broadcast({ type: 'add_forecast_row', brand: msg.brand, row: msg.row, userId: user?.id }, ws);
      }

      if (msg.type === 'delete_forecast_row') {
        if (collabState?.[msg.brand]?.[msg.ri] !== undefined) collabState[msg.brand].splice(msg.ri, 1);
        broadcast({ type: 'delete_forecast_row', brand: msg.brand, ri: msg.ri, userId: user?.id }, ws);
      }
    } catch (_) {}
  });

  ws.on('close', () => { clients.delete(ws); broadcast({ type: 'users', users: getUsers() }); });
  ws.on('error', () => { clients.delete(ws); });
  ws.on('pong',  () => { if (clients.has(ws)) clients.get(ws).alive = true; });
});

// Heartbeat — detect stale connections
setInterval(() => {
  for (const [ws, info] of clients) {
    if (!info.alive) { ws.terminate(); clients.delete(ws); continue; }
    info.alive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 30_000);

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const [ws] of clients) {
    if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function getUsers() {
  return [...clients.values()].map(({ id, color, name }) => ({ id, color, name }));
}

server.listen(PORT, () => console.log(`Valta dashboard → http://localhost:${PORT}`));
