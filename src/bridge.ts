// runs on the laptop next to the esp32. plain serial in, websocket out:
// every json line from the board goes up to the cloud hub, every command line from the
// hub goes down to the board. nothing is interpreted here, so the protocol lives in one
// place (firmware + src/board/line.ts). see docs/serial-protocol.md.
//
//   CLOUD_URL=https://138-68-238-172.sslip.io HUB_TOKEN=... npm run bridge
//   SERIAL_PORT=/dev/cu.usbserial-0001   to pick a port by hand
//   VERBOSE=1                            to log every line
import WebSocket from 'ws';
import { openSerialLink, type SerialLink } from './board/line.js';
import { config } from './config.js';

const cloud = (process.env.CLOUD_URL ?? config.hubUrl).replace(/^http/, 'ws').replace(/\/$/, '');
const token = process.env.HUB_TOKEN ?? '';
const verbose = Boolean(process.env.VERBOSE);

const log = (m: string) => console.log(`[bridge ${new Date().toTimeString().slice(0, 8)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** one session = one open serial port + one open websocket. when either drops, both close and we retry. */
async function session() {
  const link: SerialLink = await openSerialLink(config.serialPort);
  log(`serial open on ${link.path}`);

  const ws = new WebSocket(`${cloud}/bridge?token=${encodeURIComponent(token)}`);
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  }).catch((e) => {
    link.close();
    throw e;
  });
  log(`connected to ${cloud}`);

  link.onLine((line) => {
    // esp32 boot logs are not json. keep them out of the cloud.
    if (verbose) log(`< ${line}`);
    if (line.startsWith('{') && ws.readyState === WebSocket.OPEN) ws.send(line);
  });
  ws.on('message', (data) => {
    const cmd = String(data).trim();
    if (verbose) log(`> ${cmd}`);
    link.write(cmd);
  });

  await new Promise<void>((res) => {
    link.onClose(res);
    ws.once('close', res);
  });
  link.close();
  ws.close();
}

for (;;) {
  try {
    await session();
    log('link dropped');
  } catch (e) {
    log(`${(e as Error).message}`);
  }
  log('retrying in 2s');
  await sleep(2000);
}
