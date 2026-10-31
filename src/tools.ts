import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Finding, HubState, TestResult } from './types.js';

export interface BreadboardApi {
  loadProject(plan: unknown): Promise<{ ok: boolean; project: string; links: number }>;
  test(): Promise<TestResult>;
  check(): Promise<{ ok: boolean; findings: Finding[] }>;
  powerOn(): Promise<{ powered: boolean; findings: Finding[] }>;
  powerOff(): Promise<void>;
  state(): Promise<HubState>;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const list = (fs: Finding[]) => fs.map((f) => `${f.severity}: ${f.message}. fix: ${f.fix}. rows: ${f.rows.join(',')}`).join('\n');

const report = (t: TestResult) =>
  t.ok
    ? 'pass: the board matches the wiring diagram.'
    : [t.danger ? `danger: ${t.danger}. do not plug in power.` : '', 'fix in this order:', ...t.steps.map((s, i) => `${i + 1}. ${s.text}`)]
        .filter(Boolean)
        .join('\n');

export function registerTools(server: McpServer, api: BreadboardApi) {
  server.registerTool(
    'load_project',
    {
      description:
        'give the smart breadboard the wiring diagram of the project the user is building, so the notch can test it. ' +
        'the board watches 16 rows, numbered 1..16. map every net of the circuit to breadboard rows, then list each jumper or ' +
        'component lead that must join two rows as a link, with a short label (for example "led anode to 330 ohm resistor"). ' +
        'rails: the row that carries power (vcc) and the row that is ground (gnd). after loading, the user presses "Test Notch" ' +
        'on the notch, or you call test_wiring.',
      inputSchema: {
        name: z.string().describe('short project name, shown on the notch'),
        description: z.string().optional(),
        rails: z.object({ vcc: z.number().int().min(1).max(16), gnd: z.number().int().min(1).max(16) }),
        links: z
          .array(z.object({ a: z.number().int().min(1).max(16), b: z.number().int().min(1).max(16), label: z.string().optional() }))
          .min(1)
          .describe('every pair of rows that must be connected'),
        maxMa: z.number().optional().describe('current limit in ma, default 400'),
      },
    },
    async (plan) => {
      const r = await api.loadProject(plan);
      return text(`loaded "${r.project}" with ${r.links} links. the notch shows a Test Notch button now.`);
    },
  );

  server.registerTool(
    'test_wiring',
    {
      description:
        'scan the breadboard (power off) and compare it to the loaded project diagram. returns pass, or numbered steps: what to unplug, then what to plug in. the notch shows the same steps.',
    },
    async () => text(report(await api.test())),
  );

  server.registerTool(
    'check_wiring',
    {
      description:
        'scan the breadboard with power off and compare it to the circuit plan. returns pass, or each fault with the rows involved and how to fix it. call this before power_on.',
    },
    async () => {
      const r = await api.check();
      return text(r.ok ? 'pass: wiring matches the plan.' : list(r.findings));
    },
  );

  server.registerTool(
    'power_on',
    {
      description:
        'turn power on. this runs a wiring check first and refuses if any fault is found. the board cuts power by itself on overcurrent or overheat.',
    },
    async () => {
      const r = await api.powerOn();
      return text(r.powered ? 'power is on.' : 'power stays off. fix these first:\n' + list(r.findings));
    },
  );

  server.registerTool('power_off', { description: 'cut power to the breadboard now.' }, async () => {
    await api.powerOff();
    return text('power is off.');
  });

  server.registerTool(
    'get_status',
    { description: 'read the board phase, findings, and live voltage, current and temperature.' },
    async () => {
      const s = await api.state();
      return text(
        JSON.stringify({ phase: s.phase, headline: s.headline, power: s.power, telemetry: s.telemetry, findings: s.findings, plan: s.plan.name, board: s.mode }, null, 2),
      );
    },
  );
}
