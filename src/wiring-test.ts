import { analyze } from './analysis.js';
import type { CircuitPlan, FixStep, Link, TestResult } from './types.js';

// the board reports every pair of rows that conduct, so it sees nets, not single wires.
// compare nets: which rows the diagram joins, against which rows are joined now.

const nets = (links: Link[]) => {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const [a, b] of links) parent.set(find(a), find(b));
  return find;
};

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function testWiring(plan: CircuitPlan, actual: Link[]): TestResult {
  const want = nets(plan.links);
  const now = nets(actual);
  const rows = [...new Set([...plan.links.flat(), ...actual.flat()])].sort((a, b) => a - b);
  const label = (a: number, b: number) => plan.labels?.[key(a, b)];
  const steps: FixStep[] = [];

  // 1. rows joined on the board that the diagram keeps apart: unplug those first (safety).
  // the board sees groups of joined rows, not single wires, so name the rows that must separate.
  const groups = new Map<number, number[]>();
  for (const r of rows) groups.set(now(r), [...(groups.get(now(r)) ?? []), r]);
  for (const g of groups.values()) {
    const parts = new Map<number, number[]>();
    for (const r of g) parts.set(want(r), [...(parts.get(want(r)) ?? []), r]);
    if (parts.size < 2) continue;
    // the biggest part is where these rows belong. every other part is wired in by mistake
    const [main, ...stray] = [...parts.values()].sort((x, y) => y.length - x.length);
    for (const p of stray) {
      const list = (xs: number[]) => (xs.length === 1 ? `row ${xs[0]}` : `rows ${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
      steps.push({ action: 'remove', rows: [p[0], main[0]], text: `unplug the wire that joins ${list(p)} to ${list(main)}. they must not touch` });
    }
  }

  // 2. diagram links still missing once those wires are out. each new jumper can complete later ones
  const fixed: Link[] = actual.filter(([a, b]) => want(a) === want(b));
  for (const [a, b] of plan.links) {
    if (nets(fixed)(a) === nets(fixed)(b)) continue;
    const what = label(a, b);
    steps.push({ action: 'add', rows: [a, b], text: `plug a jumper from row ${a} to row ${b}${what ? ` (${what})` : ''}` });
    fixed.push([a, b]);
  }

  const rail = analyze(plan, actual).find((f) => f.kind === 'rail_short');
  return {
    ok: steps.length === 0,
    expected: plan.links.map(([a, b]) => ({ rows: [a, b] as Link, wired: now(a) === now(b), label: label(a, b) })),
    actual,
    steps,
    danger: rail ? rail.message : null,
  };
}
