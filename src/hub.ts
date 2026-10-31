import { EventEmitter } from 'node:events';
import { analyze } from './analysis.js';
import type { Board, CircuitPlan, Finding, HubState } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CheckResult {
  ok: boolean;
  findings: Finding[];
}

/** owns the board and the one shared state. the notch, mcp and texts all read it. */
export class Hub extends EventEmitter {
  state: HubState;
  private poll?: NodeJS.Timeout;

  constructor(
    readonly board: Board,
    plan: CircuitPlan,
  ) {
    super();
    this.state = {
      phase: 'idle',
      headline: 'ready',
      findings: [],
      links: [],
      power: false,
      telemetry: { mv: 0, ma: 0, tc: 0 },
      cutReason: null,
      plan,
      updatedAt: Date.now(),
      mode: board.mode,
    };
    board.onCut((reason) => this.handleCut(reason));
    board.onChange?.(() => {
      if (!this.state.power) return this.set({});
      // the link dropped while powered. the firmware keeps guarding on its own, but we cannot see it.
      clearInterval(this.poll);
      this.set({
        phase: 'fault',
        headline: 'board disconnected',
        power: false,
        findings: [{ kind: 'stray', rows: [], severity: 'warn', message: 'lost the connection to the board', fix: 'check the usb cable and that the bridge is running' }],
      });
    });
    board.setLimits(plan.maxMa).catch(() => {});
  }

  private set(patch: Partial<HubState>) {
    this.state = { ...this.state, ...patch, mode: this.board.mode, updatedAt: Date.now() };
    this.emit('state', this.state);
  }

  async checkWiring(): Promise<CheckResult> {
    if (this.state.power) {
      return { ok: false, findings: [{ kind: 'stray', rows: [], severity: 'warn', message: 'power is on, so the board cannot scan', fix: 'cut the power first' }] };
    }
    this.set({ phase: 'scanning', headline: 'scanning', cutReason: null });
    await sleep(900); // long enough for the notch to play the scan animation
    const links = await this.board.scan();
    const findings = analyze(this.state.plan, links);
    const ok = findings.length === 0;
    this.set({
      phase: ok ? 'pass' : 'fault',
      headline: ok ? 'all clear' : findings[0].message,
      findings,
      links,
    });
    if (!ok) this.emit('alert', { kind: 'fault', findings });
    return { ok, findings };
  }

  async powerOn(): Promise<CheckResult & { powered: boolean }> {
    if (this.state.power) return { ok: true, findings: [], powered: true };
    const check = await this.checkWiring();
    if (!check.ok) return { ...check, powered: false };
    await this.board.setPower(true);
    this.set({ phase: 'powered', headline: 'power on', power: true });
    this.startPolling();
    return { ...check, powered: true };
  }

  async powerOff(reason = 'manual') {
    clearInterval(this.poll);
    await this.board.setPower(false);
    this.set({ phase: 'idle', headline: 'power off', power: false, cutReason: null, findings: [] });
    this.emit('log', `power off (${reason})`);
  }

  private startPolling() {
    clearInterval(this.poll);
    this.poll = setInterval(async () => {
      try {
        const s = await this.board.status();
        if (s.power) this.set({ telemetry: { mv: s.mv, ma: s.ma, tc: s.tc, sensed: s.sensed !== false } });
      } catch {
        /* a missed read is not a fault. the board guards itself. */
      }
    }, 400);
  }

  private handleCut(reason: string) {
    clearInterval(this.poll);
    const names: Record<string, string> = {
      overcurrent: 'too much current',
      overtemperature: 'too hot',
      'board restarted': 'the board restarted',
    };
    this.set({
      phase: 'cut',
      headline: 'power cut',
      power: false,
      cutReason: names[reason] ?? reason,
      findings: [
        {
          kind: 'rail_short',
          rows: [],
          severity: 'critical',
          message: `power cut: ${names[reason] ?? reason}`,
          fix: 'leave the power off, then run a wiring check to find the cause',
        },
      ],
    });
    this.emit('alert', { kind: 'cut', reason: names[reason] ?? reason });
  }

  summary(): string {
    const s = this.state;
    if (s.phase === 'powered') return `power is on. ${s.telemetry.mv} mv, ${s.telemetry.ma} ma, ${s.telemetry.tc} c.`;
    if (s.phase === 'cut') return `power was cut: ${s.cutReason}.`;
    if (s.phase === 'fault') return s.findings.map((f) => `${f.message}. ${f.fix}.`).join(' ');
    if (s.phase === 'pass') return 'wiring is clear. power is off.';
    return 'power is off. no check yet.';
  }
}
