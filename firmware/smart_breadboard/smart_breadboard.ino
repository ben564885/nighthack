// smart breadboard firmware: esp32 (3.3v, main target) or arduino uno/nano (5v)
//
// what it does
//   1. SCAN : with power off, finds which of the 16 watched rows are connected.
//   2. ON / OFF : switches the power path (relay or logic-level mosfet).
//   3. guard : with power on, cuts power by itself on overcurrent or overtemperature.
//      no laptop needed for this part.
//
// serial: 115200 baud, one command per line, one json object per reply line.
//   PING            -> {"t":"pong"}
//   SCAN            -> {"t":"scan","links":[[1,5],[2,6]]}     rows are 1..16
//   ON              -> {"t":"ok"}   (the host checks the wiring first)
//   OFF             -> {"t":"ok"}
//   STATUS          -> {"t":"status","power":true,"mv":4980,"ma":56,"tc":26.5}
//   SET MAXMA 400   -> {"t":"ok"}
//   (unsolicited)   -> {"t":"cut","reason":"overcurrent"|"overtemperature"}
//
// wiring (pins are in the board block below)
//   drive mux  CD74HC4067 : S0-S3, SIG (through 1k), EN (active low)
//   sense mux  CD74HC4067 : S0-S3, SIG to an adc pin, EN (active low)
//   both mux channel 0..15 -> the same 16 breadboard rows (row 1 = channel 0)
//   the sense adc pin also needs a 100k resistor to gnd, so an unconnected row reads low.
//   power switch control pin (add a 10k pulldown so power is off while the chip boots)
//   thermistor (10k ntc + 10k divider) on an adc1 pin
//   ina219 (0x40) and ssd1306 oled (0x3C) on i2c
//
// esp32 notes
//   - the muxes, ina219 and oled run from 3.3v. the test voltage is 3.3v.
//   - the power switch input is 3.3v logic. a mosfet must be logic-level (vgs threshold well
//     under 3v). many relay modules need 5v to trigger: use one rated for 3.3v, or a transistor driver.
//   - upload: arduino-cli compile --fqbn esp32:esp32:esp32 firmware/smart_breadboard
//     (esp32-s3: esp32:esp32:esp32s3. pins below are for the classic esp32 devkit.)
//
// libraries: Adafruit INA219, Adafruit SSD1306, Adafruit GFX

// the team's esp32-s3 build has no i2c parts: no ina219 (current), no oled.
// without the ina219 there is NO current protection. the guard then only watches temperature.
#if defined(CONFIG_IDF_TARGET_ESP32S3)
#define USE_I2C 0
#else
#define USE_I2C 1
#endif

#if USE_I2C
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <Adafruit_SSD1306.h>
#endif

// ---- relay or mosfet? change these two lines only ---------------------------
// mosfet: HIGH turns power on, no settle delay.
// relay module: many are active low (LOW turns power on), allow ~20 ms to settle.
// test it: send ON, the relay must click and STATUS must show about 5000 mv. if the
// relay clicks at boot instead, the polarity is wrong: flip the level.
#define POWER_ACTIVE_LEVEL LOW
#define POWER_SETTLE_MS 20
// -----------------------------------------------------------------------------

#if defined(CONFIG_IDF_TARGET_ESP32S3)
// lckfb esp32-s3 board (3.3v and 5v). pins as wired by the team.
//   mux select lines S0-S3 = gpio 1-4, drive mux enable = 5, sense mux enable = 6,
//   drive mux sig = 7, sense mux sig = 8 (adc1), relay = 9.
const uint8_t DRIVE_S[4] = {1, 2, 3, 4};
const uint8_t DRIVE_EN = 5;
const uint8_t SENSE_EN = 6;
const uint8_t DRIVE_SIG = 7;
const uint8_t SENSE_SIG = 8;   // adc1
const uint8_t POWER_PIN = 9;
// the sense mux has its own select pins. S0 = 18, S1 = 17, S2 = 16, S3 = 15 (this order).
const uint8_t SENSE_S[4] = {18, 17, 16, 15};
const uint8_t THERM_PIN = 10;  // adc1 (placeholder, only if a thermistor is fitted)
const int I2C_SDA = -1;        // not used on this build
const int I2C_SCL = -1;
const int ADC_MAX = 4095;      // 12 bit
#elif defined(ARDUINO_ARCH_ESP32)
// classic esp32 devkit. avoids strapping pins (0 2 5 12 15) and flash pins (6-11).
// gpio 34-39 are input only, which is fine for the adc pins.
const uint8_t DRIVE_S[4] = {16, 17, 18, 19};
const uint8_t DRIVE_SIG = 23;
const uint8_t DRIVE_EN = 25;
const uint8_t SENSE_S[4] = {26, 27, 14, 13};
const uint8_t SENSE_EN = 33;
const uint8_t SENSE_SIG = 34;  // adc1
const uint8_t THERM_PIN = 35;  // adc1
const uint8_t POWER_PIN = 4;
const int I2C_SDA = 21;
const int I2C_SCL = 22;
const int ADC_MAX = 4095;      // 12 bit
#else
// arduino uno / nano
const uint8_t DRIVE_S[4] = {2, 3, 4, 5};
const uint8_t DRIVE_SIG = 6;
const uint8_t DRIVE_EN = 7;
const uint8_t SENSE_S[4] = {8, 9, 10, 11};
const uint8_t SENSE_EN = 12;
const uint8_t SENSE_SIG = A0;
const uint8_t THERM_PIN = A1;
const uint8_t POWER_PIN = A3;
const int ADC_MAX = 1023;      // 10 bit
#endif

const uint8_t ROWS = 16;
const int LINK_THRESHOLD = ADC_MAX / 2;  // connected rows read near full scale
const float MAX_TEMP_C = 80.0;

float maxMa = 400.0;
bool powerOn = false;
uint8_t overCount = 0;
unsigned long lastGuard = 0;

#if USE_I2C
Adafruit_INA219 ina;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
#endif
bool haveOled = false;
bool haveIna = false;

// ---- helpers ----------------------------------------------------------------
void selectChannel(const uint8_t pins[4], uint8_t ch) {
  for (uint8_t i = 0; i < 4; i++) digitalWrite(pins[i], (ch >> i) & 1);
}

void muxesOff() {
  digitalWrite(DRIVE_EN, HIGH);
  digitalWrite(SENSE_EN, HIGH);
  pinMode(DRIVE_SIG, INPUT);  // float the drive line so it cannot touch a live circuit
}

// true if both muxes were wired to the same select pins. a scan would be meaningless.
bool sharedSelects() {
  for (uint8_t i = 0; i < 4; i++)
    if (DRIVE_S[i] == SENSE_S[i]) return true;
  return false;
}

// the rails should be dead while power is off. voltage here means the relay polarity is
// wrong, or the supply is wired around the switch.
bool powerPresentWhileOff() {
#if USE_I2C
  return haveIna && !powerOn && ina.getBusVoltage_V() > 1.0;
#else
  return false;
#endif
}

float readTempC() {
  // 10k ntc, beta 3950, 10k fixed resistor to gnd
  int raw = analogRead(THERM_PIN);
  if (raw <= 0 || raw >= ADC_MAX) return 25.0;
  float r = 10000.0 * ((float)ADC_MAX / raw - 1.0);
  float k = 1.0 / (log(r / 10000.0) / 3950.0 + 1.0 / 298.15);
  return k - 273.15;
}

void show(const char* a, const char* b = "") {
#if USE_I2C
  if (!haveOled) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(2);
  oled.setCursor(0, 8);
  oled.println(a);
  oled.setTextSize(1);
  oled.setCursor(0, 44);
  oled.println(b);
  oled.display();
#endif
}

void setPower(bool on) {
  digitalWrite(POWER_PIN, on ? POWER_ACTIVE_LEVEL : !POWER_ACTIVE_LEVEL);
  delay(POWER_SETTLE_MS);
  powerOn = on;
  overCount = 0;
}

void cutPower(const char* reason) {
  setPower(false);  // first, always
  Serial.print(F("{\"t\":\"cut\",\"reason\":\""));
  Serial.print(reason);
  Serial.println(F("\"}"));
  show("power cut", reason);
}

// ---- scan -------------------------------------------------------------------
void doScan() {
  show("scanning", "power is off");
  digitalWrite(DRIVE_EN, LOW);
  digitalWrite(SENSE_EN, LOW);
  pinMode(DRIVE_SIG, OUTPUT);

  bool seen[ROWS][ROWS] = {};
  for (uint8_t i = 0; i < ROWS; i++) {
    selectChannel(DRIVE_S, i);
    digitalWrite(DRIVE_SIG, HIGH);
    delayMicroseconds(60);
    for (uint8_t j = 0; j < ROWS; j++) {
      if (j == i) continue;
      selectChannel(SENSE_S, j);
      delayMicroseconds(40);
      if (analogRead(SENSE_SIG) > LINK_THRESHOLD) seen[i][j] = true;
    }
    digitalWrite(DRIVE_SIG, LOW);
  }
  muxesOff();

  Serial.print(F("{\"t\":\"scan\",\"links\":["));
  bool first = true;
  uint8_t count = 0;
  for (uint8_t i = 0; i < ROWS; i++) {
    for (uint8_t j = i + 1; j < ROWS; j++) {
      if (seen[i][j] || seen[j][i]) {
        if (!first) Serial.print(',');
        Serial.print('[');
        Serial.print(i + 1);
        Serial.print(',');
        Serial.print(j + 1);
        Serial.print(']');
        first = false;
        count++;
      }
    }
  }
  Serial.println(F("]}"));
  show(count ? "links found" : "no links", "");
}

// ---- status -----------------------------------------------------------------
void sendStatus() {
  float mv = 0, ma = 0;
#if USE_I2C
  if (haveIna) {
    mv = ina.getBusVoltage_V() * 1000.0;
    ma = ina.getCurrent_mA();
  }
#endif
  Serial.print(F("{\"t\":\"status\",\"power\":"));
  Serial.print(powerOn ? F("true") : F("false"));
  Serial.print(F(",\"mv\":"));
  Serial.print((int)mv);
  Serial.print(F(",\"ma\":"));
  Serial.print((int)ma);
  Serial.print(F(",\"tc\":"));
  Serial.print(readTempC(), 1);
  Serial.print(F(",\"cs\":"));  // cs = a current sensor is fitted
  Serial.print(haveIna ? F("true") : F("false"));
  Serial.println('}');
}

// ---- safety guard: runs every loop, needs no laptop ---------------------------
void guard() {
  if (!powerOn) return;
  if (millis() - lastGuard < 5) return;
  lastGuard = millis();

#if USE_I2C
  if (haveIna) {
    // two reads in a row, so one noisy sample cannot cut a good build
    if (ina.getCurrent_mA() > maxMa) {
      if (++overCount >= 2) return cutPower("overcurrent");
    } else {
      overCount = 0;
    }
  }
#endif
  if (readTempC() > MAX_TEMP_C) cutPower("overtemperature");
}

// ---- serial commands ---------------------------------------------------------
void handle(String line) {
  line.trim();
  line.toUpperCase();
  if (line == "PING") {
    Serial.println(F("{\"t\":\"pong\"}"));
  } else if (line == "SCAN") {
    if (powerOn) Serial.println(F("{\"t\":\"err\",\"msg\":\"power is on, scan refused\"}"));
    else if (sharedSelects()) Serial.println(F("{\"t\":\"err\",\"msg\":\"both muxes share select pins, scan impossible\"}"));
    else if (powerPresentWhileOff()) Serial.println(F("{\"t\":\"err\",\"msg\":\"voltage on rails while off, check relay polarity\"}"));
    else doScan();
  } else if (line == "ON") {
    muxesOff();  // the scan layer must never touch a live circuit
    setPower(true);
    show("power on", "guard active");
    Serial.println(F("{\"t\":\"ok\"}"));
  } else if (line == "OFF") {
    setPower(false);
    show("power off", "");
    Serial.println(F("{\"t\":\"ok\"}"));
  } else if (line == "STATUS") {
    sendStatus();
  } else if (line.startsWith("SET MAXMA ")) {
    float v = line.substring(10).toFloat();
    if (v >= 20 && v <= 3000) {
      maxMa = v;
      Serial.println(F("{\"t\":\"ok\"}"));
    } else {
      Serial.println(F("{\"t\":\"err\",\"msg\":\"maxma out of range\"}"));
    }
  } else if (line.length()) {
    Serial.println(F("{\"t\":\"err\",\"msg\":\"unknown command\"}"));
  }
}

void setup() {
  // power must be off before anything else runs, also after a reset
  pinMode(POWER_PIN, OUTPUT);
  digitalWrite(POWER_PIN, !POWER_ACTIVE_LEVEL);

  for (uint8_t i = 0; i < 4; i++) {
    pinMode(DRIVE_S[i], OUTPUT);
    pinMode(SENSE_S[i], OUTPUT);
  }
  pinMode(DRIVE_EN, OUTPUT);
  pinMode(SENSE_EN, OUTPUT);
  pinMode(DRIVE_SIG, INPUT);
  muxesOff();

  Serial.begin(115200);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  Serial.setTxTimeoutMs(0);  // native usb: never block when no host is connected
#endif
#if defined(ARDUINO_ARCH_ESP32)
  analogReadResolution(12);
  analogSetPinAttenuation(SENSE_SIG, ADC_11db);  // full 0-3.3v range
  analogSetPinAttenuation(THERM_PIN, ADC_11db);
  // no 100k on the sense line: use the internal pull-down (~45k) instead.
  // enabled after the first analogRead, which sets the pin up for the adc.
  analogRead(SENSE_SIG);
  gpio_pullup_dis((gpio_num_t)SENSE_SIG);
  gpio_pulldown_en((gpio_num_t)SENSE_SIG);
#endif
#if USE_I2C
#if defined(ARDUINO_ARCH_ESP32)
  Wire.begin(I2C_SDA, I2C_SCL);
#else
  Wire.begin();
#endif
  haveIna = ina.begin();
  if (haveIna) ina.setCalibration_32V_2A();
  haveOled = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
#endif
  show("ready", haveIna ? "ina219 ok" : "no ina219");
  Serial.println(F("{\"t\":\"ready\"}"));
}

void loop() {
  guard();
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      handle(buf);
      buf = "";
    } else if (c != '\r' && buf.length() < 40) {
      buf += c;
    }
    guard();
  }
}
