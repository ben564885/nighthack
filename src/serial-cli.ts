// talk to the board directly over usb, no cloud involved. for bring-up and debugging.
//   npm run serial                 (auto-detects the port)
//   SERIAL_PORT=/dev/cu.usbserial-0001 npm run serial
// type PING, SCAN, ON, OFF, STATUS, SET MAXMA 400. "scan" prints a readable map.
import { createInterface } from 'node:readline';
import { openSerialLink } from './board/line.js';
import { config } from './config.js';

const link = await openSerialLink(config.serialPort);
console.log(`connected to ${link.path}. commands: PING SCAN ON OFF STATUS "SET MAXMA <ma>". ctrl-c to quit.`);

link.onLine((line) => {
  if (!line) return;
  try {
    const m = JSON.parse(line);
    if (m.t === 'scan') {
      const pairs = (m.links as number[][]).map(([a, b]) => `${a}-${b}`).join('  ');
      console.log(`scan: ${m.links.length} link(s)  ${pairs}`);
      return;
    }
  } catch {
    /* boot logs and other text fall through */
  }
  console.log(line);
});
link.onClose(() => {
  console.log('port closed');
  process.exit(1);
});

const rl = createInterface({ input: process.stdin });
rl.on('line', (l) => l.trim() && link.write(l.trim().toUpperCase()));
