// stdio mcp server: a thin client of the hub (local or deployed, set HUB_URL).
// the deployed hub also serves the same tools over http at /mcp.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { registerTools } from './tools.js';

const call = async (method: 'GET' | 'POST', path: string) => {
  const res = await fetch(config.hubUrl + path, {
    method,
    headers: process.env.HUB_TOKEN ? { 'x-hub-token': process.env.HUB_TOKEN } : {},
  });
  if (!res.ok) throw new Error(`hub error ${res.status} from ${config.hubUrl}`);
  return res.json();
};

const server = new McpServer({ name: 'smart-breadboard', version: '0.1.0' });
registerTools(server, {
  check: () => call('POST', '/api/check'),
  powerOn: () => call('POST', '/api/power-on'),
  powerOff: async () => void (await call('POST', '/api/power-off')),
  state: () => call('GET', '/api/state'),
});
await server.connect(new StdioServerTransport());
