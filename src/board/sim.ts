import type { Board, CircuitPlan, Link, Telemetry } from '../types.js';

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * software stand-in for the arduino. it holds a "real" wiring list that the
 * demo panel can edit, and it cuts power on its own like the firmware does.
 */
export class SimBoard implements Board {
  readonly mode = 'sim' as const;
  private wiring = new Map<string, Link>();
  private power = false;
  private maxMa = 400;
  private tc = 24;
  private extraMa = 0;
  private cutCb: (reason: string) => void = () => {};
  private timer?: NodeJS.Timeout;

  constructor(private plan: CircuitPlan) {
    this.maxMa = plan.maxMa;
    this.reset();
  }

  onCut(cb: (reason: string) => void) {
    this.cutCb = cb;
  }

  // ---- demo controls -------------------------------------------------
  /** a correct build */
  fix() {
    this.wiring.clear();
    this.extraMa = 0;
    this.tc = 24;
    for (const [a, b] of this.plan.links) this.addLink(a, b);
  }
  /** a build with one wrong wire and one missing wire */
  reset() {
    this.fix();
    this.wiring.delete(key(...this.plan.links[2]));
    this.addLink(5, 6);
  }
  addLink(a: number, b: number) {
    this.wiring.set(key(a, b), a < b ? [a, b] : [b, a]);
  }
  /** a hard short from 5v to gnd through a stray wire */
  railShort() {
    this.fix();
    this.addLink(5, 6);
  }
  /** a fault that only shows after power on: overcurrent */
  overload() {
    this.extraMa = this.maxMa * 3;
  }
  overheat() {
    this.tc = 95;
  }

  // ---- board api -----------------------------------------------------
  async scan(): Promise<Link[]> {
    if (this.power) throw new Error('power is on, scan refused');
    await sleep(350);
    return [...this.wiring.values()];
  }

  async setPower(on: boolean) {
    this.power = on;
    clearInterval(this.timer);
    if (!on) return;
    this.timer = setInterval(() => this.guard(), 50);
  }

  async status() {
    return { power: this.power, ...this.reading() };
  }

  async setLimits(maxMa: number) {
    this.maxMa = maxMa;
  }

  private reading(): Telemetry {
    if (!this.power) return { mv: 0, ma: 0, tc: this.tc };
    const shorted = this.hasRailShort();
    const ma = shorted ? 2400 : 38 + this.wiring.size * 6 + this.extraMa;
    return { mv: shorted ? 1900 : 4980, ma, tc: this.tc + (this.tc < 90 ? 2 : 0) };
  }

  private hasRailShort() {
    const { vcc, gnd } = this.plan.rails;
    const seen = new Set([vcc]);
    const queue = [vcc];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const [a, b] of this.wiring.values()) {
        const next = a === cur ? b : b === cur ? a : null;
        if (next !== null && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen.has(gnd);
  }

  private guard() {
    const r = this.reading();
    const reason = r.ma > this.maxMa ? 'overcurrent' : r.tc > 80 ? 'overtemperature' : null;
    if (!reason) return;
    this.power = false;
    clearInterval(this.timer);
    this.cutCb(reason);
  }
}
