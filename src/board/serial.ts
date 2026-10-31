import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import type { Board, Link, Telemetry } from '../types.js';

type Msg = { t: string; [k: string]: unknown };

async function findPort(): Promise<string> {
  const ports = await SerialPort.list();
  const hit = ports.find((p) => /usbmodem|usbserial|ttyACM|ttyUSB|COM\d+/i.test(p.path));
  if (!hit) throw new Error('no arduino found. set SERIAL_PORT or plug in the board');
  return hit.path;
}

/** talks to firmware/smart_breadboard over usb serial, one json line per message */
export class SerialBoard implements Board {
  readonly mode = 'serial' as const;
  private port!: SerialPort;
  private waiters: Array<{ types: string[]; resolve: (m: Msg) => void; reject: (e: Error) => void }> = [];
  private cutCb: (reason: string) => void = () => {};

  static async open(path?: string) {
    const board = new SerialBoard();
    await board.connect(path ?? (await findPort()));
    return board;
  }

  private async connect(path: string) {
    this.port = new SerialPort({ path, baudRate: 115200 });
    const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (line: string) => this.onLine(line.trim()));
    await new Promise<void>((res, rej) => this.port.once('open', (e) => (e ? rej(e) : res())));
    // opening the port resets most arduinos. wait for the boot message.
    await this.request('PING', ['pong', 'ready'], 6000).catch(() => this.request('PING', ['pong'], 3000));
  }

  onCut(cb: (reason: string) => void) {
    this.cutCb = cb;
  }

  private onLine(line: string) {
    if (!line.startsWith('{')) return;
    let msg: Msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.t === 'cut') this.cutCb(String(msg.reason ?? 'unknown'));
    const i = this.waiters.findIndex((w) => w.types.includes(msg.t) || msg.t === 'err');
    if (i >= 0) {
      const [w] = this.waiters.splice(i, 1);
      msg.t === 'err' ? w.reject(new Error(String(msg.msg))) : w.resolve(msg);
    }
  }

  private request(cmd: string, types: string[], timeoutMs = 3000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`board timeout on ${cmd}`)), timeoutMs);
      this.waiters.push({
        types,
        resolve: (m) => (clearTimeout(timer), resolve(m)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.port.write(cmd + '\n');
    });
  }

  async scan(): Promise<Link[]> {
    const m = await this.request('SCAN', ['scan']);
    return m.links as Link[];
  }
  async setPower(on: boolean) {
    await this.request(on ? 'ON' : 'OFF', ['ok']);
  }
  async status() {
    const m = await this.request('STATUS', ['status']);
    return m as unknown as Telemetry & { power: boolean };
  }
  async setLimits(maxMa: number) {
    await this.request(`SET MAXMA ${Math.round(maxMa)}`, ['ok']);
  }
}
