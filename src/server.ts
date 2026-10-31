import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, normalize, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { config, loadPlan } from './config.js';
import { Hub } from './hub.js';
import { SimBoard } from './board/sim.js';
import { SwitchBoard } from './board/switch.js';
import { openSerialLink, LineBoard } from './board/line.js';
import { WebSocketServer, type WebSocket } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';
import { PhotonChannel } from './photon.js';
import { makeAgent } from './agent.js';
import { placeCall } from './voice.js';
import type { Finding } from './types.js';

const plan = loadPlan();
// the board is the real one when the laptop bridge is connected, else the simulator.
// BOARD=serial skips the bridge and opens a usb port on this machine (local use).
const sim = new SimBoard(plan);
let board: SwitchBoard | LineBoard;
if (config.boardMode === 'serial') {
  board = new LineBoard(await openSerialLink(config.serialPort));
  await board.handshake();
} else {
  board = new SwitchBoard(sim);
}
const hub = new Hub(board, plan);
// keep the notch's wiring map live while power is off. AUTO_SCAN_MS=0 turns it off.
hub.startWatch(Number(process.env.AUTO_SCAN_MS ?? 500));
const token = process.env.HUB_TOKEN ?? '';
// never run in production with the control routes open
if (process.env.NODE_ENV === 'production' && !token) throw new Error('HUB_TOKEN is required in production');
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const photon = new PhotonChannel();

// ---- alerts: notch is always on, text for every fault, call only when serious
const lastAlert = new Map<string, number>();
const cooledDown = (k: string, ms = 20_000) => {
  const now = Date.now();
  if (now - (lastAlert.get(k) ?? 0) < ms) return false;
  lastAlert.set(k, now);
  return true;
};

hub.on('alert', async (a: { kind: 'fault'; findings: Finding[] } | { kind: 'cut'; reason: string }) => {
  const critical = a.kind === 'cut' || a.findings.some((f) => f.severity === 'critical');
  const text =
    a.kind === 'cut'
      ? `power cut: ${a.reason}. the board is off. run a wiring check before turning it back on.`
      : a.findings
          .slice(0, 2)
          .map((f) => `${f.message}. ${f.fix}.`)
          .join(' ');
  if (!cooledDown(`text:${a.kind}`)) return;
  await photon.send(text).catch((e) => console.log('[photon] send failed:', e.message));
  if (critical && cooledDown('call', 60_000)) {
    const spoken = a.kind === 'cut' ? `your breadboard cut the power. ${a.reason}.` : `your breadboard has a dangerous wiring fault. ${text}`;
    await placeCall(spoken).catch((e) => console.log('[voice]', e.message));
  }
});

photon.start(makeAgent(hub));

// ---- http: notch page, state stream, control api
const notchHtml = () => readFileSync(new URL('../notch/index.html', import.meta.url), 'utf8');
const clients = new Set<ServerResponse>();
hub.on('state', (s) => clients.forEach((c) => c.write(`data: ${JSON.stringify(s)}\n\n`)));

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = async (req: IncomingMessage) => {
  let raw = '';
  for await (const c of req) {
    raw += c;
    if (raw.length > 1_000_000) throw new Error('body too large');
  }
  return raw ? JSON.parse(raw) : {};
};

const authed = (req: IncomingMessage, url: URL) =>
  !token || same(String(req.headers['x-hub-token'] ?? ''), token) || same(url.searchParams.get('key') ?? '', token);

const mcpApi = {
  check: () => hub.checkWiring(),
  powerOn: () => hub.powerOn(),
  powerOff: () => hub.powerOff('mcp'),
  state: async () => hub.state,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, board: hub.state.mode });
    if ((req.method !== 'GET' || url.pathname === '/mcp') && !authed(req, url)) return json(res, 401, { error: 'missing or wrong key' });
    if (url.pathname === '/mcp') {
      // stateless streamable http: one server per request, safe behind any proxy
      const mcp = new McpServer({ name: 'smart-breadboard', version: '0.1.0' });
      registerTools(mcp, mcpApi);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => void mcp.close());
      await mcp.connect(transport);
      return void (await transport.handleRequest(req, res, req.method === 'POST' ? await readBody(req) : undefined));
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(readFileSync(new URL('../site/index.html', import.meta.url)));
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      return res.end(readFileSync(new URL('../site/assets/favicon-64.png', import.meta.url)));
    }
    if (req.method === 'GET' && url.pathname === '/notch') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(notchHtml());
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const file = join(new URL('../site/assets', import.meta.url).pathname, normalize(url.pathname.slice(8)).replace(/^(\.\.[/\\])+/, ''));
      if (!existsSync(file)) return json(res, 404, { error: 'not found' });
      const types: Record<string, string> = { '.woff2': 'font/woff2', '.js': 'text/javascript', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=86400' });
      return res.end(readFileSync(file));
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(hub.state)}\n\n`);
      clients.add(res);
      return void req.on('close', () => clients.delete(res));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, hub.state);
    if (req.method === 'POST' && url.pathname === '/api/check') return json(res, 200, await hub.checkWiring());
<<<<<<< Updated upstream
    if (req.method === 'POST' && url.pathname === '/api/stage') return json(res, 200, hub.stage(Boolean((await readBody(req)).on)));
    if (req.method === 'POST' && url.pathname === '/api/project') return json(res, 200, await hub.setProject(Boolean((await readBody(req)).on)));
=======
>>>>>>> Stashed changes
    if (req.method === 'POST' && url.pathname === '/api/power-on') return json(res, 200, await hub.powerOn());
    if (req.method === 'POST' && url.pathname === '/api/power-off') {
      await hub.powerOff('api');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/sim/') && sim) {
      if (board instanceof SwitchBoard && board.mode !== 'sim') return json(res, 409, { error: 'real board connected, sim controls are off' });
      const action = url.pathname.split('/').pop();
      const body = await readBody(req);
      if (action === 'fix') sim.fix();
      else if (action === 'reset') sim.reset();
      else if (action === 'short') sim.addLink(Number(body.a ?? 5), Number(body.b ?? 6));
      else if (action === 'rail-short') sim.railShort();
      else if (action === 'overload') sim.overload();
      else if (action === 'overheat') sim.overheat();
      else return json(res, 404, { error: 'unknown sim action' });
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

// the laptop bridge connects here and becomes the board
if (board instanceof SwitchBoard) {
  const switchBoard = board;
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/bridge' || (token && !same(url.searchParams.get('token') ?? '', token))) return socket.destroy();
    wss.handleUpgrade(req, socket, head, async (ws: WebSocket) => {
      const handlers: Array<(l: string) => void> = [];
      ws.on('message', (d) => String(d).split('\n').forEach((l) => l.trim() && handlers.forEach((h) => h(l.trim()))));
      ws.on('close', () => switchBoard.detach());
      try {
        await switchBoard.attach({ write: (l) => ws.send(l), onLine: (cb) => handlers.push(cb) });
        console.log('[bridge] real board connected');
      } catch (e) {
        console.log('[bridge] handshake failed:', (e as Error).message);
        ws.close();
      }
    });
  });
}

// behind caddy in production: only the local proxy may reach the hub
server.listen(config.port, process.env.HOST ?? '127.0.0.1', () => console.log(`[hub] up on :${config.port}, board: ${hub.state.mode}`));
