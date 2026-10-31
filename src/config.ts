import 'dotenv/config';
import { readFileSync } from 'node:fs';
import type { CircuitPlan } from './types.js';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  boardMode: (process.env.BOARD ?? 'sim') as 'sim' | 'serial',
  serialPort: process.env.SERIAL_PORT,
  planFile: process.env.PLAN ?? new URL('../circuits/sensor-hookup.json', import.meta.url).pathname,
  hubUrl: process.env.HUB_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL ?? 'claude-haiku-5-5',
  photon: {
    key: process.env.PHOTON_API_KEY,
    projectId: process.env.PHOTON_PROJECT_ID,
    userHandle: process.env.USER_PHONE_NUMBER,
  },
  voice: {
    key: process.env.ELEVENLABS_API_KEY,
    agentId: process.env.ELEVENLABS_AGENT_ID,
    phoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID,
  },
};

export const loadPlan = (file = config.planFile): CircuitPlan => JSON.parse(readFileSync(file, 'utf8'));
