// rows are numbered 1..16 everywhere: plan files, serial protocol, text, ui.
export type Link = [number, number];

export interface CircuitPlan {
  name: string;
  description: string;
  rails: { vcc: number; gnd: number };
  /** connections that must exist. anything else that conducts is a stray link. */
  links: Link[];
  maxMa: number;
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
