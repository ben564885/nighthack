# smart breadboard

ai-checked wiring. scan before power-on, cut power on any fault, warn on the mac and on your phone.

## run (works with no hardware)

```sh
npm install
cp .env.example .env     # fill in keys
npm run hub              # sim board + notch at http://localhost:3000
```

- open `http://localhost:3000/?dev` (or press `d`) for the demo panel: check, power on, break the build, fix it, overload.
- `?overlay` makes the page background transparent.
- claude code picks up `.mcp.json`, so `check_wiring`, `power_on`, `power_off`, `get_status` are available as tools (the hub must be running).

## real board

```sh
BOARD=serial npm run hub          # auto-detects the arduino, or set SERIAL_PORT=/dev/cu.usbmodem...
```

flash `firmware/smart_breadboard` first (`arduino-cli compile --fqbn arduino:avr:uno firmware/smart_breadboard`).
relay instead of mosfet: edit `POWER_ACTIVE_LEVEL` and `POWER_SETTLE_MS` at the top of the sketch. nothing else changes.

## layout

| path | what |
|---|---|
| `firmware/smart_breadboard` | arduino: scan, power switch, autonomous cutoff, oled |
| `src/analysis.ts` | scan result + circuit plan -> faults and fixes |
| `src/hub.ts` | shared state: check, power on/off, alerts |
| `src/board/` | `sim.ts` (no hardware) and `serial.ts` (real board) |
| `src/mcp.ts` | mcp tools for claude |
| `src/photon.ts`, `src/agent.ts` | two-way imessage agent |
| `src/voice.ts` | outbound call for serious faults |
| `notch/index.html` | the notch ui |
| `circuits/*.json` | the circuit plan: rails, required links, current limit |

## photon

needs `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `USER_PHONE_NUMBER` in `.env`.
a shared line cannot start a chat: text the agent number once, then alerts work.
texts understood: "is my circuit safe?", "status", "cut the power". power on is never allowed by text.
