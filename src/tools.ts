import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Finding, HubState } from './types.js';

export interface BreadboardApi {
  check(): Promise<{ ok: boolean; findings: Finding[] }>;
  powerOn(): Promise<{ powered: boolean; findings: Finding[] }>;
  powerOff(): Promise<void>;
  state(): Promise<HubState>;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const list = (fs: Finding[]) => fs.map((f) => `${f.severity}: ${f.message}. fix: ${f.fix}. rows: ${f.rows.join(',')}`).join('\n');

export function registerTools(server: McpServer, api: BreadboardApi) {
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
