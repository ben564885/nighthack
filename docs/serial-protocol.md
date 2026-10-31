# serial protocol

plain text over usb serial. no mcp, no framing library. the esp32 firmware and
`src/board/line.ts` are the only two places that know it.

- **link:** usb serial, 115200 baud, 8n1, no flow control.
- **commands:** one per line, ascii, `\n` terminated. case does not matter.
- **replies:** one json object per line, always with a `"t"` (type) field.
- **boot logs:** the esp32 prints non-json text when it starts. every line that does not
  start with `{` is ignored.
- **rows:** numbered 1..16 everywhere.

## commands

| command | reply | notes |
|---|---|---|
| `PING` | `{"t":"pong"}` | liveness check |
| `SCAN` | `{"t":"scan","links":[[1,5],[2,6]]}` | maps connected rows. refused while power is on |
| `ON` | `{"t":"ok"}` | muxes are disabled first, then power switches on. the host checks wiring before sending this |
| `OFF` | `{"t":"ok"}` | power off. always allowed |
| `STATUS` | `{"t":"status","power":true,"mv":4980,"ma":56,"tc":26.5}` | voltage mv, current ma, temperature c |
| `SET MAXMA <n>` | `{"t":"ok"}` | current limit, 20..3000 ma. default 400 |

## errors

`{"t":"err","msg":"power is on, scan refused"}` and `{"t":"err","msg":"unknown command"}`.
one reply per command, so a host can match replies to requests by order.

## messages the board sends by itself

| message | when |
|---|---|
| `{"t":"ready"}` | after every boot or reset. the board always boots with power **off**. |
| `{"t":"cut","reason":"overcurrent"}` | the board cut power. reasons: `overcurrent`, `overtemperature` |

if the host sees `ready` while it thinks power is on, the board restarted and power is off
(`LineBoard` reports it as "board restarted").

## safety rules the firmware keeps on its own

- power is off at boot, before any other code runs.
- the guard loop reads current and temperature every 5 ms while power is on and cuts power
  by itself. it never waits for the host.
- the muxes are disabled before `ON`, and `SCAN` is refused while power is on.

## trying it by hand

```sh
npm run serial          # talks to the board directly, no cloud
```

```
> PING
{"t":"pong"}
> SCAN
scan: 3 link(s)  1-5  2-6  7-10
> STATUS
{"t":"status","power":false,"mv":0,"ma":0,"tc":24.8}
```

## the bridge

`npm run bridge` runs on the laptop next to the board and copies lines both ways between the
serial port and the cloud hub (websocket). it interprets nothing. if the usb cable drops, it
closes the websocket (the hub falls back to the simulator and shows "board disconnected") and
retries every 2 seconds.

```sh
CLOUD_URL=https://138-68-238-172.sslip.io HUB_TOKEN=... npm run bridge
VERBOSE=1 ...            # log every line
SERIAL_PORT=/dev/cu.usbserial-0001 ...   # pick a port by hand
```
