# Smart Breadboard: Night Hack Context

Single source of truth for the team. Update it as decisions change.

## 1. Event

**Night Hack by Founders, Inc.** Friday, Oct 30, 2026. Founders, Inc. San Francisco Lab, 2 Marina Blvd, Building C (B300), Fort Mason. Third floor, turn left, hallway with the Blueprint sign. Have the Luma QR code ready.

### Schedule
| Time | What |
|---|---|
| 4:00 PM | Check-in + team formation |
| 4:15 PM | Kickoff + partner intros, then hacking |
| ~6:00 PM | Pizza |
| **9:00 PM** | **Submissions due** |
| ~10:00 PM | Top 7 live demos |
| 10:30 PM | Awards |
| 11:00 PM | Event wraps. No re-entry after 10 PM. |

### Rules that matter to us
- Teams of up to 4. Every teammate needs their own approved registration.
- Existing code, models and hardware are allowed. **We must clearly disclose what existed before kickoff.** Judges score the work done during the sprint.
- **Live demos only, no slides.** 90 seconds per demo, 2-minute hard stop.
- Software demos cannot be localhost-only. Test links on another device.
- Hardware teams: bring the full setup, tools, cables, chargers, spares, **and a software or simulation fallback**.
- The venue does NOT provide hardware, electronics-lab access, soldering, fabrication or 3D printing.
- Submission (one per team): teammates, captain contact details, tools used, what we built tonight, working demo with access instructions. The form is shared via Luma and in the room.
- Expect strong competition: some teams arrive with prebuilt startups and pitch one new feature.

### Prizes
- Top 3: cash, Anthropic API credits ($5k / $3k / $2k), 3 months Firecrawl Growth, up to $500 HeyPCB fabrication per team. 1st also gets a Founders, Inc. guest pass.
- Photon award ($1,000): best AI agent people can text on iMessage. Needs a reachable iMessage number or handle. SMS-only does not qualify. (In our plan: see section 3c.)
- Builder perks after check-in: Anthropic $50 credits (200 redemptions), Firecrawl 10k credits, Photon $100, HeyPCB one month Starter, Bolt, Mercury offers. Redemption details come via Luma after check-in.
- Partners: Firecrawl, Bolt, Convex, Anthropic, Photon, Mercury, HeyPCB, Nebula.

## 2. Team and Prior Work

- **Team:** Ben, Sebastian, Seyhan, Philip (Philip owns the parts).
- **Prior work:** None. Nothing of this project existed before kickoff, so there is nothing to disclose.

## 2b. The Idea

### Pitch
More people now build electronics from AI-written instructions. One wrong wire can fry parts or start a fire.

### Solution
A **smart breadboard** that lets the AI *see* the circuit, **catches wiring mistakes before power-on**, and **cuts power instantly** if anything goes wrong.

Philip reviewed the idea and confirmed it is viable.

### Demo story (draft, to be confirmed)
1. A user asks Claude for help building a circuit.
2. The user wires it on the breadboard.
3. Claude calls `check_wiring`. The board scans the circuit and reports the result (for example "SHORT: rows 3 and 7").
4. The user fixes the mistake. Claude re-checks and gets PASS.
5. Claude calls `power_on`.
6. Fault injection: cause an overcurrent or short. The Arduino cuts power on its own, with no laptop involved. The OLED shows "Power cut".

## 3. Hardware Stack

### Breadboard and test points
- 16 rows wired underneath to header pins. This is the "watched" build area.

### Scanning layer
- Two **CD74HC4067** 16-channel muxes, both connected to the same 16 rows.
  - **Drive mux:** sends a safe test voltage through a resistor into one row.
  - **Sense mux:** reads every other row through an Arduino analog input.
- A voltage on another row means the two rows connect. The resistance reading maps the whole circuit in a fraction of a second.

### Power path
```
Power supply -> INA219 (current/voltage sensor) -> logic-level MOSFET (on/off switch) -> breadboard power rails
```
- A small temperature sensor (thermistor or MLX90614) sits near the parts.
- **Open question:** a relay may replace the MOSFET. See section 6.

### Brain
- **ESP32** (changed from Arduino) runs the scan, the power switch and the safety cutoff. The same sketch also builds for an Arduino Uno.
- 3.3V logic. The muxes, INA219 and OLED run from 3.3V, so the test voltage is 3.3V. The power switch must work with a 3.3V signal: a logic-level MOSFET, or a relay module rated for 3.3V.
- The host talks to the board by plain serial commands. See `docs/serial-protocol.md`. No MCP between the laptop and the board.
- It kills the switch **on its own** if current or temperature exceeds limits. No laptop required.

### Display
- OLED shows status: "PASS", "SHORT: rows 3 and 7", "Power cut".

### Laptop and AI layer
- Arduino talks to the laptop over USB serial.
- An **MCP server** exposes Claude-callable tools: `check_wiring`, `power_on`.

### Hard constraints
- **The scan runs only while power is off.** Disable the muxes before power-on so they do not interfere with the live circuit.
- **Voltage limit is 5V or below** (limit of the mux chips).

## 3b. The Notch (laptop display layer)

A software overlay at the top of the MacBook screen, like the iPhone Dynamic Island. It warns the user when the wiring, the board or the circuit has a fault, and it shows how to fix it.

### Behavior
- Shows the breadboard state: PASS, SHORT, Power cut.
- On a fault, shows one line of text (for example "Short: rows 3 and 7") and a fix instruction.
- Optional animation, for example a highlight of the two rows that connect.

### Rules
- The Notch is a display only. The Arduino cuts power on its own. The safety cutoff must never depend on the Notch or the laptop.
- The board knows only which rows connect. It does not know which part is wrong. Claude must combine the scan result with the circuit plan to write a correct fix.

### Build order (animation last)
1. No animation. A colored state (green, red) and one line of text.
2. Add the fix text from Claude, based on the scan result and the circuit plan.
3. Add the animation only if time remains.

### Demo value
The demo is 90 seconds with no slides. A judge cannot see a short circuit on a breadboard. The Notch makes the fault visible on the screen.

### Open question
- [ ] Native macOS window, or a web page styled as a notch? A web page is faster. A native window looks better on the demo laptop.

## 3c. Photon iMessage Agent (phone alerts, two-way)

The Mac shows the Notch. A Photon iMessage agent also sends a text to the user. The user can text back.

### Behavior
- **Alert:** On a fault or a power cut, the agent texts the user with the problem and the fix (same content as the Notch).
- **Two-way commands:** The user texts the agent. Examples: "Is my circuit safe?" calls `check_wiring`. "Cut the power" calls a power-off tool. "What is the status?" returns the last state.
- **Phone call (stretch):** For a very serious fault, call the user. Photon is built for iMessage. We do not know if it supports calls. Check at kickoff. If it is not simple, skip it and describe it only in the pitch.

### Why
- The user is not always at the screen. If a fault happens while they are away, the text reaches them.
- The Photon prize ($1,000) is for an agent people can text. An alert-only message might not qualify, so the agent must accept replies.
- The prize needs a reachable iMessage number or handle in the submission. Plan for this early.

### Rules
- The Arduino cuts power on its own. The Notch, the text and the call are alerts only. No safety function depends on them.
- The demo must not depend on Wi-Fi or on iMessage delay. The Notch is the main display. The text is an extra.
- A remote "power on" command is a risk. Allow remote "cut power" and status only. Power on needs the local user to start it (decision to confirm).

### Priority order
1. Core: scan, safety cutoff, MCP server.
2. The Notch (basic version).
3. Photon iMessage alert, then two-way commands.
4. Phone call, only if time remains.
5. Notch animation, last.

### Open questions
- [ ] Does Photon support calls? Ask at kickoff.
- [ ] Which iMessage number or handle do we give in the submission?
- [ ] Who builds the Photon agent?

## 3d. Build Status (software)

**Production:** https://138-68-238-172.sslip.io (landing page at `/`). Runs on the team's DigitalOcean droplet. Details and commands are in `README.md`. The secret `HUB_TOKEN` is not in git: ask Ben.

Built and tested in simulation. See `README.md` for how to run.

| Part | State |
|---|---|
| Analysis (shorts, rail short, missing links) | done, tested |
| Hub + sim board + demo panel | done, tested |
| Notch UI (web page, arcs, live readings, auto-close after 15 s or on hover off) | done, checked in browser |
| Native Mac notch app (`mac/`, sits on the real hardware notch) | built, runs. Visual check on the Mac still needed. |
| Landing page at `/` (pixel-art sky style, live demo loop) | done |
| Laptop bridge (`npm run bridge`) + cloud hub (token, `/mcp`) | done, tested with a fake board |
| MCP server (`check_wiring`, `power_on`, `power_off`, `get_status`) | done, tested |
| Text agent (Claude, tools, instant "cut power") | done, tested with sim |
| Firmware | one sketch, ESP32 and Uno pin blocks. Both compile (ESP32: 25% of flash). **Not tested on hardware.** |
| Serial layer + laptop bridge (`npm run bridge`) + serial test tool (`npm run serial`) | done. Tested against a fake ESP32 on a virtual port and the production hub: handshake, check, power on, unplug fallback. **Not tested on a real ESP32.** |
| Photon iMessage | running in production, polling with the real key. Agent number **+16283167976**. **Owner must text it once** before alerts can send. Round trip not yet tested. |
| Phone call | code written for ElevenLabs over Photon SIP. **Not tested.** Needs a dedicated Photon number and ElevenLabs keys. |

### Photon facts (from the 2.0 beta docs)
- Our key (`pho_sk_...`) is bound to one project. It needs the project ID (`pho_prj_...`).
- A shared line cannot send the first message. The owner must text the agent first.
- Calls need a dedicated number, not a shared line. Photon gives the phone line (SIP). The voice comes from a voice agent (ElevenLabs is the documented path).
- Photon 2.0 iMessage supports text and images only.

### Safety design
- The Arduino guards power by itself (current and temperature). The hub, Notch, texts and calls are alerts only.
- Remote power on is not allowed by text. Cut power and status are allowed.

## 4. Parts and Prep

- Philip likely has all required parts. Nobody needs to buy components.
- One part may need improvising: relay instead of MOSFET.
- Bring a software or simulation fallback (event requirement).

## 5. Work Items

1. Build the hardware (scan layer, power path, safety cutoff, OLED).
2. Write the Arduino firmware: scan, short detection, current and temperature limits, serial protocol.
3. Write the MCP server: `check_wiring`, `power_on` (and likely a status tool).
4. Prepare and coordinate the live demo (90 seconds, no slides).
5. Build the Notch (see section 3b). Build the basic version first. Add animation last.
6. Build the Photon iMessage agent (see section 3c).
7. Build the simulation fallback.
8. Submission by 9:00 PM.

## 6. Open Questions

- [ ] **MOSFET or relay?** Philip's parts decide this. Ben will update after the team reaches the car/parts. A relay is slower but simpler. Confirm it can handle the supply current at 5V.
- [ ] **Who owns what?** Assign hardware, firmware, MCP/AI layer, Notch, demo and submission.
- [ ] **Tracks and judging criteria.** Learn at kickoff.
- [ ] **Team approval.** Confirm all four teammates are approved on Luma.
- [ ] **Photon prize.** Now in scope as a two-way iMessage agent (section 3c).

## 7. Action Items from the Meeting

- Get to Founders, Inc. independently via Waymo (Zorgi).
- Take notes during the opening announcements.
- Coordinate the live demo and build out the Notch.

## 8. Links

- Meeting transcript: https://notes.granola.ai/t/b3042558-5c15-425e-ac05-c656a7fd7a67
- Directions: https://f.inc/3c
- Repo: https://github.com/ben564885/nighthack
