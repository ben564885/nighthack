import { EventEmitter } from 'node:events';
import { analyze } from './analysis.js';
import { testWiring } from './wiring-test.js';
import { noticeText } from './notice.js';
import type { Board, CircuitPlan, Finding, HubState, Link, TestResult } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NOTICE_PAUSE_MS = 1200;
const NOTICE_GAP_MS = 4000;
const SCAN_FAILED = 'scan failed';

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
      test: null,
      hold: false,
      staged: false,
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
    this.scheduleNotice();
  }

  // ---- one text for every popup of the notch -------------------------------------------------
  // the notch opens when the phase, findings, links, project or test change. a text goes out for
  // each of those too: joined over a short pause, and never closer together than NOTICE_GAP_MS.
  private noticeSig = '';
  private noticeTimer?: NodeJS.Timeout;
  private lastNotice = '';
  private lastNoticeAt = 0;
  private noticed = false;

  private scheduleNotice() {
    const s = this.state;
    if (s.phase === 'scanning') return; // the notch is still scanning. wait for the result
    const sig = JSON.stringify([s.phase, s.findings, s.links, s.project, s.power, s.staged, s.test && s.test.steps, s.test && s.test.ok]);
    if (sig === this.noticeSig) return;
    this.noticeSig = sig;
    clearTimeout(this.noticeTimer);
    const wait = Math.max(NOTICE_PAUSE_MS, this.lastNoticeAt + NOTICE_GAP_MS - Date.now());
    this.noticeTimer = setTimeout(() => this.sendNotice(), wait);
  }

  private sendNotice() {
    const s = this.state;
    // a quiet start (nothing wired, no project) keeps the notch closed, so no text either
    if (!this.noticed && s.phase === 'idle' && !s.links.length && !s.project && !s.test) return;
    const text = noticeText(s);
    if (!text || text === this.lastNotice) return;
    this.noticed = true;
    this.lastNotice = text;
    this.lastNoticeAt = Date.now();
    this.emit('notice', text);
  }

  /** runs a command with the background scan paused, after any scan already on the wire */
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    // any real command ends a staged demo state
    if (this.state.staged) this.set({ staged: false, hold: false });
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
    if (s.staged || this.busy || this.inflight || s.power || s.phase === 'cut' || s.phase === 'scanning') return;
    this.inflight = this.board
      .scan()
      .then((links) => {
        // a command or a staged demo fault started meanwhile owns the state now
        if (this.busy || this.state.power || this.state.staged) return;
        const same = JSON.stringify(links) === JSON.stringify(this.state.links);
        if (same && this.state.headline !== SCAN_FAILED) return;
        this.applyScan(links);
      })
      .catch(() => {
        /* a missed scan is not a fault. the next one runs shortly. */
      })
      .finally(() => {
        this.inflight = null;
      });
  }

  /** a background scan only records the live links. a changed board makes the last check stale. */
  private applyScan(links: HubState['links']) {
    const n = links.length;
    // while a test is on screen, keep its steps in step with the board as the user rewires
    const test = this.state.test ? testWiring(this.state.plan, links) : null;
    this.set({ phase: 'idle', headline: n ? `${n} connection${n === 1 ? '' : 's'}` : 'no connections', findings: [], links, test });
  }

  /** claude hands over a project's wiring diagram. power_on checks against it from now on */
  loadProject(plan: CircuitPlan) {
    return this.exclusive(async () => {
      this.set({ plan, project: plan.name, test: null });
      await this.board.setLimits(plan.maxMa).catch(() => {});
      return { ok: true, project: plan.name, links: plan.links.length };
    });
  }

  /** "Test Notch": scan, compare to the project's diagram, list the fixes in order */
  testProject() {
    return this.exclusive(async () => {
      if (!this.state.project) throw new Error('no project loaded. ask claude to load one');
      if (this.state.power) throw new Error('power is on, so the board cannot scan. cut the power first');
      const links = await this.board.scan();
      const test = testWiring(this.state.plan, links);
      const n = links.length;
      this.set({ phase: 'idle', headline: n ? `${n} connection${n === 1 ? '' : 's'}` : 'no connections', findings: [], links, test });
      return test;
    });
  }

  endTest() {
    this.set({ test: null, staged: false, hold: false });
    return { ok: true };
  }

  /**
   * show the project as fully wired, for a demo. like stage(), it is not read from the board, so it
   * is marked `staged` and the notch labels it "demo". "Test again" or "Done" ends it.
   */
  stagePass() {
    if (!this.state.project) throw new Error('no project loaded. ask claude to load one');
    const { links, labels } = this.state.plan;
    const test: TestResult = {
      ok: true,
      expected: links.map(([a, b]) => ({ rows: [a, b] as Link, wired: true, label: labels?.[`${a}-${b}`] })),
      actual: links,
      steps: [],
      danger: null,
    };
    this.set({ staged: true, hold: false, test, links, phase: 'idle', findings: [] });
    return test;
  }

  /**
   * put a power-to-ground fault on the notch and keep it there until released.
   * it goes through the real analysis (same message and fix as a real scan), but it is not read
   * from the board, so it is marked `staged` and the notch labels it "demo". it sends no alerts.
   */
  stage(on: boolean) {
    if (!on) {
      this.set({ staged: false, hold: false, phase: 'idle', headline: 'ready', findings: [], links: [], power: false });
      return { ok: true, staged: false };
    }
    const links: HubState['links'] = [[1, 5], [2, 6], [5, 6], [7, 10]];
    const findings = analyze(this.state.plan, links);
    this.set({ staged: true, hold: true, phase: 'fault', headline: findings[0].message, findings, links, power: false, cutReason: null });
    return { ok: true, staged: true, findings };
  }

  checkWiring(): Promise<CheckResult> {
    return this.exclusive(async () => {
      if (this.state.power) {
        return { ok: false, findings: [{ kind: 'stray', rows: [], severity: 'warn', message: 'power is on, so the board cannot scan', fix: 'cut the power first' }] };
      }
      this.set({ phase: 'scanning', headline: 'scanning', cutReason: null });
      await sleep(900); // long enough for the notch to play the scan animation
      let links: HubState['links'];
      try {
        links = await this.board.scan();
      } catch (e) {
        // never leave the notch stuck on "scanning". the background scan retries.
        const findings: Finding[] = [{ kind: 'stray', rows: [], severity: 'warn', message: `the board did not answer the scan (${(e as Error).message})`, fix: 'check the usb cable and that the bridge is running, then check again' }];
        this.set({ phase: 'fault', headline: SCAN_FAILED, findings });
        return { ok: false, findings };
      }
      // claude's check compares the board to the circuit plan
      const findings = analyze(this.state.plan, links);
      const ok = findings.length === 0;
      this.set({ phase: ok ? 'pass' : 'fault', headline: ok ? 'all clear' : findings[0].message, findings, links });
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
