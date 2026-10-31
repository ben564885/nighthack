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
  private watch?: NodeJS.Timeout;
  /** commands in progress. the background scan never runs alongside one. */
  private busy = 0;
  private inflight: Promise<void> | null = null;

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
      project: null,
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

  /** runs a command with the background scan paused, after any scan already on the wire */
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.busy++;
    try {
      await this.inflight;
      return await fn();
    } finally {
      this.busy--;
    }
  }

  /** rescan the board every `ms` while power is off, so the notch always shows the real wiring */
  startWatch(ms: number) {
    clearInterval(this.watch);
    if (ms > 0) this.watch = setInterval(() => this.backgroundScan(), ms);
  }

  private backgroundScan() {
    const s = this.state;
    if (this.busy || this.inflight || s.power || s.phase === 'cut' || s.phase === 'scanning') return;
    this.inflight = this.board
      .scan()
      .then((links) => {
        // a command started meanwhile owns the state now
        if (this.busy || this.state.power) return;
        if (JSON.stringify(links) === JSON.stringify(this.state.links)) return;
        this.applyScan(links);
      })
      .catch(() => {
        /* a missed scan is not a fault. the next one runs shortly. */
      })
      .finally(() => {
        this.inflight = null;
      });
  }

  /** watch mode lists the links. project mode compares them to the plan. */
  private applyScan(links: HubState['links']) {
    if (!this.state.project) {
      const n = links.length;
      this.set({ phase: 'idle', headline: n ? `${n} connection${n === 1 ? '' : 's'}` : 'no connections', findings: [], links });
      return [];
    }
    const findings = analyze(this.state.plan, links);
    const ok = findings.length === 0;
    this.set({ phase: ok ? 'pass' : 'fault', headline: ok ? 'all clear' : findings[0].message, findings, links });
    return findings;
  }

  /** start the demo project (the loaded plan), or go back to watching the bare board */
  setProject(on: boolean) {
    return this.exclusive(async () => {
      if (on) {
        this.set({ project: this.state.plan.name });
        return this.checkWiring();
      }
      this.set({ project: null });
      if (!this.state.power) this.applyScan(this.state.links);
      return { ok: true, findings: [] };
    });
  }

  checkWiring(): Promise<CheckResult> {
    return this.exclusive(async () => {
      if (this.state.power) {
        return { ok: false, findings: [{ kind: 'stray', rows: [], severity: 'warn', message: 'power is on, so the board cannot scan', fix: 'cut the power first' }] };
      }
      // a check always compares against the plan, so it starts the project
      this.set({ phase: 'scanning', headline: 'scanning', cutReason: null, project: this.state.plan.name });
      await sleep(900); // long enough for the notch to play the scan animation
      const findings = this.applyScan(await this.board.scan());
      const ok = findings.length === 0;
      if (!ok) this.emit('alert', { kind: 'fault', findings });
      return { ok, findings };
    });
  }

  powerOn(): Promise<CheckResult & { powered: boolean }> {
    return this.exclusive(async () => {
      if (this.state.power) return { ok: true, findings: [], powered: true };
      const check = await this.checkWiring();
      if (!check.ok) return { ...check, powered: false };
      await this.board.setPower(true);
      this.set({ phase: 'powered', headline: 'power on', power: true });
      this.startPolling();
      return { ...check, powered: true };
    });
  }

  powerOff(reason = 'manual') {
    return this.exclusive(async () => {
      clearInterval(this.poll);
      await this.board.setPower(false);
      this.set({ phase: 'idle', headline: 'power off', power: false, cutReason: null, findings: [] });
      this.emit('log', `power off (${reason})`);
    });
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
