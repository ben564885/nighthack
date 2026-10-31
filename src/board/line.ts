import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import type { Board, Link, Telemetry } from '../types.js';

type Msg = { t: string; [k: string]: unknown };

/** a line-based pipe to the firmware: usb serial locally, or a websocket from the bridge */
export interface LineLink {
  write(line: string): void;
  onLine(cb: (line: string) => void): void;
}

export async function findPort(): Promise<string> {
  const ports = await SerialPort.list();
  const hit = ports.find((p) => /usbmodem|usbserial|ttyACM|ttyUSB|COM\d+/i.test(p.path));
  if (!hit) throw new Error('no arduino found. set SERIAL_PORT or plug in the board');
  return hit.path;
}

export async function openSerialLink(path?: string): Promise<LineLink> {
  const port = new SerialPort({ path: path ?? (await findPort()), baudRate: 115200 });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
  await new Promise<void>((res, rej) => port.once('open', (e) => (e ? rej(e) : res())));
  return {
    write: (line) => port.write(line + '\n'),
    onLine: (cb) => parser.on('data', (l: string) => cb(l.trim())),
  };
}

/** speaks the firmware protocol (see firmware/smart_breadboard) over any LineLink */
export class LineBoard implements Board {
  readonly mode = 'serial' as const;
  private waiters: Array<{ types: string[]; resolve: (m: Msg) => void; reject: (e: Error) => void }> = [];
  private cutCb: (reason: string) => void = () => {};

  constructor(private link: LineLink) {
    link.onLine((line) => this.onLine(line));
  }

  /** opening a usb port resets most arduinos, so wait for the boot message */
  async handshake() {
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
      this.link.write(cmd);
    });
  }

  async scan(): Promise<Link[]> {
    return (await this.request('SCAN', ['scan'])).links as Link[];
  }
  async setPower(on: boolean) {
    await this.request(on ? 'ON' : 'OFF', ['ok']);
  }
  async status() {
    return (await this.request('STATUS', ['status'])) as unknown as Telemetry & { power: boolean };
  }
  async setLimits(maxMa: number) {
    await this.request(`SET MAXMA ${Math.round(maxMa)}`, ['ok']);
  }
}
