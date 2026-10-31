# smart breadboard

ai-checked wiring. scan before power-on, cut power on any fault, warn on the mac and on your phone.

## production

live at **https://138-68-238-172.sslip.io** (digitalocean droplet, caddy for https, systemd keeps the hub up).

| what | how |
|---|---|
| landing page | `/` |
| notch page | `/notch` |
| mcp for claude | `https://138-68-238-172.sslip.io/mcp?key=$HUB_TOKEN` (see `.mcp.json`, set `HUB_TOKEN` in your shell) |
| mac notch app | `mac/build.sh https://138-68-238-172.sslip.io && open mac/SmartNotch.app` |
| real arduino | on the laptop with the board: `CLOUD_URL=https://138-68-238-172.sslip.io HUB_TOKEN=... npm run bridge` |
| redeploy | `./deploy.sh` (never sends `.env`) |
| logs | `ssh root@138.68.238.172 journalctl -u smart-breadboard -f` |

without the bridge the hub runs the simulator, so the demo always works.

## run locally (works with no hardware)

```sh
npm install
cp .env.example .env     # fill in keys
npm run hub              # sim board + notch at http://localhost:3000
```

- `/` is the landing page (a self-running walk-around). `/notch` is the notch page.
- open `http://localhost:3000/notch?dev` (or press `d`) for the demo panel: check, power on, break the build, fix it, overload.
- `?overlay` makes the page background transparent.
- claude code picks up `.mcp.json`, so `check_wiring`, `power_on`, `power_off`, `get_status` are available as tools (the hub must be running).

## the notch on your mac

```sh
mac/build.sh https://YOUR-HUB-URL     # builds mac/SmartNotch.app with the url baked in
open mac/SmartNotch.app               # no dock icon. quit with: pkill SmartNotch
```

a transparent, click-through window pinned to the real hardware notch (size read from macos).
it is invisible until something needs you, then grows downward. it closes after 15 seconds,
or when the pointer goes onto it and then off. a new event opens it again.

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
| `notch/index.html` | the notch ui (served at `/notch`) |
| `mac/` | native notch app (swift) |
| `site/` | landing page and its art |
| `src/bridge.ts` | runs on the laptop, passes arduino serial to the cloud hub |
| `circuits/*.json` | the circuit plan: rails, required links, current limit |

## photon

needs `PHOTON_API_KEY`, `PHOTON_PROJECT_ID`, `USER_PHONE_NUMBER` in `.env`.
a shared line cannot start a chat: text the agent number once, then alerts work.
texts understood: "is my circuit safe?", "status", "cut the power". power on is never allowed by text.
