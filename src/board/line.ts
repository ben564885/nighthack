import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import type { Board, Link, Telemetry } from '../types.js';

type Msg = { t: string; [k: string]: unknown };

/** a line-based pipe to the firmware: usb serial locally, or a websocket from the bridge */
export interface LineLink {
  write(line: string): void;
  onLine(cb: (line: string) => void): void;
}

export interface SerialLink extends LineLink {
  readonly path: string;
  onClose(cb: () => void): void;
  close(): void;
}

// usb-serial chips found on esp32 boards, plus arduino. vendor ids are lowercase hex.
const KNOWN_VENDORS = new Set(['10c4', '1a86', '0403', '303a', '2341', '2a03']);
const PORT_NAME = /usbserial|usbmodem|SLAB_USBtoUART|wchusbserial|ttyUSB|ttyACM|COM\d+/i;

export async function findPort(): Promise<string> {
  const ports = await SerialPort.list();
  // on macos each port shows up twice: cu.* (use this) and tty.* (blocks on open)
  const usable = ports.filter((p) => !/\/dev\/tty\./.test(p.path));
  const byVendor = usable.find((p) => p.vendorId && KNOWN_VENDORS.has(p.vendorId.toLowerCase()));
  const hit = byVendor ?? usable.find((p) => PORT_NAME.test(p.path));
  if (!hit) {
    const seen = ports.map((p) => p.path).join(', ') || 'none';
    throw new Error(`no esp32 found (ports seen: ${seen}). plug in the board or set SERIAL_PORT`);
  }
  return hit.path;
}

/**
 * opens the board's usb serial port without resetting it. most esp32 dev boards wire
 * dtr/rts to the en and boot pins, so we release both lines right after opening.
 */
export async function openSerialLink(path?: string): Promise<SerialLink> {
  const resolved = path ?? (await findPort());
  const port = new SerialPort({ path: resolved, baudRate: 115200, hupcl: false, autoOpen: false });
  await new Promise<void>((res, rej) => port.open((e) => (e ? rej(e) : res())));
  await new Promise<void>((res) => port.set({ dtr: false, rts: false }, () => res()));
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
  return {
    path: resolved,
    write: (line) => port.write(line + '\n'),
    onLine: (cb) => parser.on('data', (l: string) => cb(l.trim())),
    onClose: (cb) => {
      port.once('close', cb);
      port.once('error', cb);
    },
    close: () => port.isOpen && port.close(),
  };
}

/** speaks the firmware protocol (see firmware/smart_breadboard) over any LineLink */
export class LineBoard implements Board {
  readonly mode = 'serial' as const;
  private waiters: Array<{ types: string[]; resolve: (m: Msg) => void; reject: (e: Error) => void }> = [];
  private cutCb: (reason: string) => void = () => {};
  private handshaken = false;

  constructor(private link: LineLink) {
    link.onLine((line) => this.onLine(line));
  }

  /** opening a usb port resets most arduinos, so wait for the boot message */
  async handshake() {
    await this.request('PING', ['pong', 'ready'], 6000).catch(() => this.request('PING', ['pong'], 3000));
    this.handshaken = true;
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
    // the firmware boots with power off. a 'ready' after the handshake means the board restarted
    // (brown-out, watchdog, someone pressed reset), so any power the hub thinks is on is gone.
    if (msg.t === 'ready' && this.handshaken) this.cutCb('board restarted');
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
