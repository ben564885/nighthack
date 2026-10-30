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
- Photon award ($1,000): best AI agent people can text on iMessage. Needs a reachable iMessage number or handle. SMS-only does not qualify. (Possible side angle for us; not in the current plan.)
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
- **Arduino** runs the scan, the power switch and the safety cutoff.
- It kills the switch **on its own** if current or temperature exceeds limits. No laptop required.

### Display
- OLED shows status: "PASS", "SHORT: rows 3 and 7", "Power cut".

### Laptop and AI layer
- Arduino talks to the laptop over USB serial.
- An **MCP server** exposes Claude-callable tools: `check_wiring`, `power_on`.

### Hard constraints
- **The scan runs only while power is off.** Disable the muxes before power-on so they do not interfere with the live circuit.
- **Voltage limit is 5V or below** (limit of the mux chips).

## 4. Parts and Prep

- Philip likely has all required parts. Nobody needs to buy components.
- One part may need improvising: relay instead of MOSFET.
- Bring a software or simulation fallback (event requirement).

## 5. Work Items

1. Build the hardware (scan layer, power path, safety cutoff, OLED).
2. Write the Arduino firmware: scan, short detection, current and temperature limits, serial protocol.
3. Write the MCP server: `check_wiring`, `power_on` (and likely a status tool).
4. Prepare and coordinate the live demo (90 seconds, no slides).
5. Build the Notch: a software overlay at the top of the MacBook screen, like the iPhone Dynamic Island. It shows the breadboard status (PASS, SHORT, Power cut) on the laptop screen.
6. Build the simulation fallback.
7. Submission by 9:00 PM.

## 6. Open Questions

- [ ] **MOSFET or relay?** Philip's parts decide this. Ben will update after the team reaches the car/parts. A relay is slower but simpler. Confirm it can handle the supply current at 5V.
- [ ] **Who owns what?** Assign hardware, firmware, MCP/AI layer, Notch, demo and submission.
- [ ] **Tracks and judging criteria.** Learn at kickoff.
- [ ] **Team approval.** Confirm all four teammates are approved on Luma.
- [ ] **Photon side prize?** Only if an iMessage interface is cheap to add. Probably out of scope.

## 7. Action Items from the Meeting

- Get to Founders, Inc. independently via Waymo (Zorgi).
- Take notes during the opening announcements.
- Coordinate the live demo and build out the Notch.

## 8. Links

- Meeting transcript: https://notes.granola.ai/t/b3042558-5c15-425e-ac05-c656a7fd7a67
- Directions: https://f.inc/3c
- Repo: https://github.com/ben564885/nighthack
