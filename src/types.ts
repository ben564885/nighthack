// rows are numbered 1..16 everywhere: plan files, serial protocol, text, ui.
export type Link = [number, number];

export interface CircuitPlan {
  name: string;
  description: string;
  rails: { vcc: number; gnd: number };
  /** connections that must exist. anything else that conducts is a stray link. */
  links: Link[];
  maxMa: number;
  /** what each link is for, keyed "a-b" with a < b, e.g. "led anode to resistor" */
  labels?: Record<string, string>;
}

/** one thing to do on the breadboard, in order: removals first, then additions */
export interface FixStep {
  action: 'remove' | 'add';
  rows: Link;
  text: string;
}

/** a press of "Test Notch": the project's diagram against what is wired */
export interface TestResult {
  ok: boolean;
  /** the wiring diagram links, each marked by whether the board has it */
  expected: Array<{ rows: Link; wired: boolean; label?: string }>;
  /** what the board sees now */
  actual: Link[];
  steps: FixStep[];
  /** power touches ground somewhere: say so before anything else */
  danger: string | null;
}

export interface Telemetry {
  mv: number;
  ma: number;
  tc: number;
  /** false when the board has no current sensor. then ma is not a measurement. */
  sensed?: boolean;
}

export interface Finding {
  kind: 'rail_short' | 'stray' | 'missing';
  rows: number[];
  severity: 'warn' | 'critical';
  message: string;
  fix: string;
}

export type Phase = 'idle' | 'scanning' | 'pass' | 'fault' | 'powered' | 'cut';

export interface HubState {
  phase: Phase;
  headline: string;
  findings: Finding[];
  links: Link[];
  power: boolean;
  telemetry: Telemetry;
  cutReason: string | null;
  plan: CircuitPlan;
  /** name of a project Claude loaded (load_project), or null: then the notch only shows live wiring */
  project: string | null;
  /** last "Test Notch" result, kept live while the board changes. null when not testing */
  test: TestResult | null;
  /** the notch stays open until the hold is released (demo use) */
  hold: boolean;
  /** this state was put on screen by hand for a demo, not read from the board */
  staged: boolean;
  updatedAt: number;
  mode: 'sim' | 'serial';
}

export interface Board {
  readonly mode: 'sim' | 'serial';
  scan(): Promise<Link[]>;
  setPower(on: boolean): Promise<void>;
  status(): Promise<Telemetry & { power: boolean }>;
  setLimits(maxMa: number): Promise<void>;
  /** called when the board cuts power by itself */
  onCut(cb: (reason: string) => void): void;
  /** optional: fires when the board behind this one changes */
  onChange?(cb: () => void): void;
}
