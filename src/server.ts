import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { config, loadPlan } from './config.js';
import { Hub } from './hub.js';
import { SimBoard } from './board/sim.js';
import { SerialBoard } from './board/serial.js';
import { PhotonChannel } from './photon.js';
import { makeAgent } from './agent.js';
import { placeCall } from './voice.js';
import type { Finding } from './types.js';

const plan = loadPlan();
const board = config.boardMode === 'serial' ? await SerialBoard.open(config.serialPort) : new SimBoard(plan);
const hub = new Hub(board, plan);
const sim = board instanceof SimBoard ? board : null;
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
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(notchHtml());
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(hub.state)}\n\n`);
      clients.add(res);
      return void req.on('close', () => clients.delete(res));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, hub.state);
    if (req.method === 'POST' && url.pathname === '/api/check') return json(res, 200, await hub.checkWiring());
    if (req.method === 'POST' && url.pathname === '/api/power-on') return json(res, 200, await hub.powerOn());
    if (req.method === 'POST' && url.pathname === '/api/power-off') {
      await hub.powerOff('api');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/sim/') && sim) {
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
}).listen(config.port, () => console.log(`[hub] ${board.mode} board. notch at http://localhost:${config.port}`));
