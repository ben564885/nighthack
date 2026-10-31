import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import type { Hub } from './hub.js';

const SYSTEM = `you are the voice of a smart breadboard, replying over imessage.
rules: write only in lowercase. keep replies under 3 short sentences. no markdown, no emojis.
you can check the wiring, read the status, and cut the power. you can never turn power on by text.
if the user asks to turn power on, say they must do it at their computer after a clean check.
always call a tool before you claim anything about the board.`;

const tools: Anthropic.Tool[] = [
  { name: 'check_wiring', description: 'scan the breadboard (power must be off) and list wiring faults', input_schema: { type: 'object', properties: {} } },
  { name: 'get_status', description: 'read the last known board state and live power readings', input_schema: { type: 'object', properties: {} } },
  { name: 'cut_power', description: 'cut the power to the breadboard now', input_schema: { type: 'object', properties: {} } },
];

const CUT = /\b(cut|kill|stop|shut|off|emergency)\b/i;

export function makeAgent(hub: Hub) {
  const client = config.anthropicKey ? new Anthropic({ apiKey: config.anthropicKey }) : null;

  const run = async (name: string): Promise<string> => {
    if (name === 'check_wiring') {
      const r = await hub.checkWiring();
      return r.ok ? 'wiring is clear' : r.findings.map((f) => `${f.message}. fix: ${f.fix}`).join('\n');
    }
    if (name === 'cut_power') {
      await hub.powerOff('text command');
      return 'power is off';
    }
    return hub.summary();
  };

  return async function handle(text: string): Promise<string> {
    // the cut command never waits for a model
    if (CUT.test(text) && !/\b(on|turn on)\b/i.test(text)) {
      await hub.powerOff('text command');
      return 'power cut. the board is off.';
    }
    if (!client) return hub.summary();
    try {
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: text }];
      for (let i = 0; i < 4; i++) {
        const res = await client.messages.create({ model: config.model, max_tokens: 300, system: SYSTEM, tools, messages });
        const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (!uses.length) {
          const out = res.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ').trim();
          return out.toLowerCase();
        }
        messages.push({ role: 'assistant', content: res.content });
        messages.push({
          role: 'user',
          content: await Promise.all(
            uses.map(async (u) => ({ type: 'tool_result' as const, tool_use_id: u.id, content: await run(u.name) })),
          ),
        });
      }
      return hub.summary();
    } catch (e) {
      console.log('[agent] model error:', (e as Error).message);
      return hub.summary();
    }
  };
}
