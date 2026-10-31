import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';

// thin client: the hub owns the board, so the notch and claude see the same state.
const call = async (method: 'GET' | 'POST', path: string) => {
  const res = await fetch(config.hubUrl + path, { method });
  if (!res.ok) throw new Error(`hub error ${res.status}. is "npm run hub" running?`);
  return res.json();
};
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

const server = new McpServer({ name: 'smart-breadboard', version: '0.1.0' });

server.registerTool(
  'check_wiring',
  {
    description:
      'scan the breadboard with power off and compare it to the circuit plan. returns pass, or each fault with the rows involved and how to fix it. call this before power_on.',
  },
  async () => {
    const r = await call('POST', '/api/check');
    if (r.ok) return text('pass: wiring matches the plan.');
    return text(
      r.findings.map((f: any) => `${f.severity}: ${f.message}. fix: ${f.fix}. rows: ${f.rows.join(',')}`).join('\n'),
    );
  },
);

server.registerTool(
  'power_on',
  {
    description:
      'turn power on. this runs a wiring check first and refuses if any fault is found. the board cuts power by itself on overcurrent or overheat.',
  },
  async () => {
    const r = await call('POST', '/api/power-on');
    if (r.powered) return text('power is on.');
    return text(
      'power stays off. fix these first:\n' + r.findings.map((f: any) => `${f.message}. fix: ${f.fix}`).join('\n'),
    );
  },
);

server.registerTool('power_off', { description: 'cut power to the breadboard now.' }, async () => {
  await call('POST', '/api/power-off');
  return text('power is off.');
});

server.registerTool(
  'get_status',
  { description: 'read the board phase, findings, and live voltage, current and temperature.' },
  async () => {
    const s = await call('GET', '/api/state');
    return text(JSON.stringify({ phase: s.phase, headline: s.headline, power: s.power, telemetry: s.telemetry, findings: s.findings, plan: s.plan.name }, null, 2));
  },
);

await server.connect(new StdioServerTransport());
