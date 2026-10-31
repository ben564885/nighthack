# flash the firmware (esp32-s3)

for the teammate who has the board. about 10 minutes, no libraries to install: the s3 build
has no i2c parts (no ina219, no oled).

## 1. get the code

```sh
git clone https://github.com/ben564885/nighthack.git
cd nighthack
```

the repo is private. ask Ben for access if the clone fails.

## 2. install the tools (once)

```sh
brew install arduino-cli
arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
```

the esp32 core is big (about 1 gb) and takes a few minutes. start it early.

## 3. plug in and find the port

plug the board in with usb-c, then:

```sh
arduino-cli board list
```

look for a port like `/dev/cu.usbmodem1101` (windows: `COM5`). use the `cu.` one, not `tty.`.

## 4. compile and upload

```sh
arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc firmware/smart_breadboard
arduino-cli upload  --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc -p /dev/cu.usbmodem1101 firmware/smart_breadboard
```

replace the port with yours. `CDCOnBoot=cdc` is required: it makes the usb port the serial port.

**if the upload fails** ("failed to connect", port missing): hold the **BOOT** button, tap **RESET**,
release **BOOT**, then run the upload again. after uploading, tap RESET once.

arduino ide instead of the cli: board `ESP32S3 Dev Module`, `USB CDC On Boot: Enabled`, open
`firmware/smart_breadboard/smart_breadboard.ino`, press upload.

## 5. check that it works

```sh
npm install
npm run serial
```

type these and compare:

| you type | you should see |
|---|---|
| `PING` | `{"t":"pong"}` |
| `STATUS` | `{"t":"status","power":false,"mv":0,"ma":0,"tc":...,"cs":false}` |
| `SCAN` | `{"t":"scan","links":[...]}` (a link means two rows are connected) |
| `ON` | `{"t":"ok"}` and the **relay clicks** |
| `OFF` | `{"t":"ok"}` and the relay clicks again |

boot messages that are not json are normal. the board also sends `{"t":"ready"}` after every reset.
the full command list is in [serial-protocol.md](serial-protocol.md).

## 6. connect it to the cloud (so the notch and claude see it)

```sh
CLOUD_URL=https://138-68-238-172.sslip.io HUB_TOKEN=<ask Ben> npm run bridge
```

close `npm run serial` first. only one program can hold the usb port.
when the bridge connects, the notch shows the real board instead of the simulator.

## pins (as built)

| signal | gpio |
|---|---|
| drive mux select S0-S3 | 1, 2, 3, 4 |
| sense mux select S0-S3 | 18, 17, 16, 15 (S0 = 18) |
| drive mux enable (CS) | 5 |
| sense mux enable (CS) | 6 |
| drive mux SIG | 7 |
| sense mux SIG (adc) | 8 |
| relay control | 9 |

to change a pin, edit the s3 block near the top of `firmware/smart_breadboard/smart_breadboard.ino`.

## things to know before you power anything

- **relay polarity.** the firmware assumes the relay turns on with a LOW signal (`POWER_ACTIVE_LEVEL`
  at the top of the sketch). send `ON` and check: the relay must click then, not at boot. if it clicks at
  boot instead, flip `POWER_ACTIVE_LEVEL` to `HIGH`, re-upload, and tell Ben.
- **no current sensor.** there is no ina219, so the board cannot cut power on overload. status shows
  `"cs":false`. do not rely on the cutoff. keep a fuse on the supply.
- **3.3 v logic.** the muxes run from 3.3 v, so the test voltage is 3.3 v. the relay module must trigger from a
  3.3 v signal.
- **scan only runs with power off.** the board refuses `SCAN` while power is on.

## troubleshooting

| problem | fix |
|---|---|
| `arduino-cli board list` shows nothing | try another usb cable (some are charge-only), or enter boot mode (hold BOOT, tap RESET) |
| upload says "failed to connect" | boot mode, as above |
| `npm run serial` says "no esp32 found" | set the port: `SERIAL_PORT=/dev/cu.usbmodem1101 npm run serial` |
| `PING` gets no answer | wrong build option: re-upload with `CDCOnBoot=cdc`. also tap RESET |
| `SCAN` returns links you did not wire | check the sense mux select wires (18, 17, 16, 15 in that order) and that both muxes have 3.3 v and gnd |
| `SCAN` returns `[]` on a wired board | check the 100k pulldown on the sense signal line, and the drive mux 1k resistor |
| relay clicks at boot | flip `POWER_ACTIVE_LEVEL` |
