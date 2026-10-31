// runs on the laptop next to the arduino. connects OUT to the cloud hub and
// passes serial lines both ways, so nothing needs a public address at home.
import WebSocket from 'ws';
import { openSerialLink } from './board/line.js';
import { config } from './config.js';

const cloud = (process.env.CLOUD_URL ?? config.hubUrl).replace(/^http/, 'ws').replace(/\/$/, '');
const token = process.env.HUB_TOKEN ?? '';

const link = await openSerialLink(config.serialPort);
console.log('[bridge] arduino open');

let ws: WebSocket | null = null;
link.onLine((line) => ws?.readyState === WebSocket.OPEN && ws.send(line));

function connect() {
  ws = new WebSocket(`${cloud}/bridge?token=${encodeURIComponent(token)}`);
  ws.on('open', () => console.log('[bridge] connected to', cloud));
  ws.on('message', (data) => link.write(String(data).trim()));
  ws.on('close', () => {
    console.log('[bridge] disconnected, retrying in 2s');
    setTimeout(connect, 2000);
  });
  ws.on('error', (e) => console.log('[bridge] error:', e.message));
}
connect();
