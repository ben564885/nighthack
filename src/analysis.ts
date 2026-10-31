import type { CircuitPlan, Finding, Link } from './types.js';

class UnionFind {
  private parent = new Map<number, number>();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: number, b: number) {
    this.parent.set(this.find(a), this.find(b));
  }
  same(a: number, b: number) {
    return this.find(a) === this.find(b);
  }
}

const build = (links: Link[]) => {
  const uf = new UnionFind();
  for (const [a, b] of links) uf.union(a, b);
  return uf;
};

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** shortest path of rows between two rows in the scanned graph */
function path(links: Link[], from: number, to: number): number[] | null {
  const adj = new Map<number, number[]>();
  for (const [a, b] of links) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const prev = new Map<number, number>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const n of adj.get(cur) ?? []) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        queue.push(n);
      }
    }
  }
  if (!prev.has(to)) return null;
  const out = [to];
  while (out[0] !== from) out.unshift(prev.get(out[0])!);
  return out;
}

export function analyze(plan: CircuitPlan, scanned: Link[]): Finding[] {
  const findings: Finding[] = [];
  const planned = new Set(plan.links.map(([a, b]) => key(a, b)));
  const expectedNets = build(plan.links);
  const actualNets = build(scanned);
  const { vcc, gnd } = plan.rails;

  // 1. rails touching: the dangerous one
  if (actualNets.same(vcc, gnd)) {
    const route = path(scanned, vcc, gnd) ?? [vcc, gnd];
    const culprit = route
      .slice(1)
      .map((r, i) => [route[i], r] as Link)
      .find(([a, b]) => !planned.has(key(a, b)));
    findings.push({
      kind: 'rail_short',
      rows: route,
      severity: 'critical',
      message: `5v is connected to gnd (rows ${route.join(' → ')})`,
      fix: culprit
        ? `remove the wire between row ${culprit[0]} and row ${culprit[1]}`
        : `check every wire between row ${vcc} and row ${gnd}`,
    });
  }

  // 2. stray links: conduct, but the plan says they must not
  for (const [a, b] of scanned) {
    if (planned.has(key(a, b)) || expectedNets.same(a, b)) continue;
    if (findings.some((f) => f.kind === 'rail_short' && f.rows.includes(a) && f.rows.includes(b))) continue;
    const touchesRail = [a, b].some((r) => r === vcc || r === gnd);
    findings.push({
      kind: 'stray',
      rows: [a, b],
      severity: touchesRail ? 'critical' : 'warn',
      message: `rows ${a} and ${b} are connected but should not be`,
      fix: `pull the wire or leg that joins row ${a} and row ${b}`,
    });
  }

  // 3. missing links: the plan needs them, the scan did not see them
  for (const [a, b] of plan.links) {
    if (actualNets.same(a, b)) continue;
    findings.push({
      kind: 'missing',
      rows: [a, b],
      severity: 'warn',
      message: `row ${a} and row ${b} are not connected`,
      fix: `add a jumper from row ${a} to row ${b}`,
    });
  }

  const rank = { critical: 0, warn: 1 } as const;
  return findings.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
