# Connecting the Scout rig

The laptop is the backend host. The UNO controls timing, ultrasonic pings, the servo, and LEDs; it never receives Google credentials. The USB webcam connects directly to the laptop and is physically mounted to the turret.

## 1. Wire the components

Use an Arduino UNO R3, SG90, HC-SR04, GY-521/MPU-6050, common-cathode RGB LED, passive piezo buzzer, and a momentary button.

- SG90 signal → **D9**. Servo ground → shared GND. Use a suitable regulated external 5 V servo supply rather than relying on the UNO regulator for motor current; join supply and UNO grounds. Do not connect competing 5 V power sources together.
- HC-SR04 Trig → **D10**, Echo → **D11**, VCC → UNO 5 V, GND → GND. UNO's 5 V inputs suit this sensor; a 3.3 V replacement MCU needs appropriate echo level shifting.
- GY-521 SDA → **A4**, SCL → **A5**, GND → GND, VCC → the voltage specified for your breakout (typical GY-521 boards include a regulator; verify your module). AD0 low selects address **0x68**. This firmware expects the base accelerometer's X axis to align with uphill and Y with cross slope.
- RGB LED red channel → **D5 through a 220–330 Ω resistor**, green → **D6 through its own resistor**, common cathode → GND. Blue is unused. Yellow combines red and green. Common-anode LEDs need inverted output logic.
- Passive piezo buzzer → **D7** and GND. Use a driver for loads exceeding GPIO ratings; the sketch assumes a small piezo.
- Button → **D2 and GND**. Firmware uses `INPUT_PULLUP`, so a press pulls D2 LOW.
- UNO USB → laptop. Webcam USB → laptop.

The plan's “9-wire” description does not count every power, ground, indicator, and button connection. Follow actual electrical connections rather than a wire count. Keep cable slack clear through the entire sweep, and use a camera light enough for the SG90.

## 2. Flash firmware

1. Open `firmware/scout_radar/scout_radar.ino` in Arduino IDE.
2. Install **Servo by Arduino**, and use the **Arduino AVR Boards** core. `Wire` is provided by the AVR core. No MPU-6050 library or ArduinoJson is required.
3. Choose **Arduino Uno** and the connected USB serial port.
4. Upload, then open Serial Monitor at **115200 baud**, newline endings. Send `PING`; expect `{"type":"ready","protocol":1}`.
5. Close Serial Monitor before connecting Scout so only one program owns the port.

CLI equivalent, after installing the CLI/core/library:

```bash
arduino-cli core install arduino:avr
arduino-cli lib install Servo
arduino-cli compile --fqbn arduino:avr:uno firmware/scout_radar
arduino-cli upload --fqbn arduino:avr:uno -p /dev/cu.usbmodemYOURPORT firmware/scout_radar
```

The source was compiled for UNO against AVR core 1.8.6 and Servo 1.3.0. Compilation does not validate electrical wiring or physical motion. This build was not uploaded to any device during implementation.

## 3. Connect the backend

Run `.venv/bin/python scripts/run.py`. Under **Settings → Arduino & camera**:

1. Refresh the serial-port list. Choose the UNO's `/dev/cu.usbmodem...` or `/dev/cu.usbserial...` port on macOS; Windows uses `COM...`, Linux often `/dev/ttyACM...`.
2. Set the camera index, typically `0` or `1`. A webcam must remain fixed relative to the ultrasonic beam. macOS may require Camera permission for the terminal/Python host when capture first runs.
3. Save and click **Connect device**. The backend waits for UNO reset, sends PING, and verifies protocol version 1.
4. Start **New inspection → Live hardware**. The frontend streams readings from the backend using SSE, so the browser never accesses serial directly.
5. To use the physical button, enable it in Settings, choose its baseline/profile, and optionally enable AI. Leave the backend and serial connection open. Each D2 press emits a button event, which starts the same backend workflow. Busy presses are ignored.

One rig and one active inspection are supported. Do not run multiple backend workers or keep Serial Monitor open simultaneously.

## 4. Align and calibrate

Mount the sensor acoustical origin as close to the servo pivot as practical. Put the IMU flat on a rigid base with three contact feet. An alignment fence is necessary to make the physical X/Y axes meaningful; software cannot determine yaw misalignment from gravity alone.

- At 0° the beam should face the left boundary; at 180° it should face the right. The dashboard uses the same convention.
- Position the rig in the actual opening plane. A single sweep measures one height; verify that other heights or door positions do not reduce clear width.
- Set **Turret offset** to a measured geometric correction for your mount. Do not add an arbitrary chassis width. With co-located measurement origin and pivot, start at zero.
- Near-boundary samples at 0°, 5°, 10° and 170°, 175°, 180° are projected to the lateral axis. Each side needs at least two valid returns. Their median projections are summed, corrected by the known alignment angle, then adjusted by the turret offset.
- For flip calibration, record **signed** pitch/roll readings; rotate the entire base 180° in place on the same plane and record again. `bias=(forward+reverse)/2`; corrected slope is `(forward-reverse)/2`. Enter these in **Calibration lab → Flip calibration**. Bias is subtracted from subsequent readings before taking magnitudes.
- Compare widths against a tape measure and slope angles against a calibrated inclinometer across your expected operating range. Record each trial in the lab. Use the resulting errors to choose conservative width and slope bounds; only then mark calibration verified.
- Flipping removes a constant bias under ideal alignment. It does not by itself establish ±0.15° accuracy or remove all noise, yaw, vibration, beam-width, and surface-reflection errors.

Manual threshold height and handle height can be supplied in the scan dialog; the firmware cannot measure these vertically with one horizontal axis.

## 5. Serial contract

Commands are ASCII, newline-terminated, at 115200 baud:

```text
PING
SCAN
AIM 40
STATUS PASS
STATUS WARN
STATUS FAIL
STOP
```

`SCAN` performs 25 IMU samples for stillness, then 37 servo stops in 5° increments. Each stop collects 15 pings spaced at least 60 ms apart, rejects invalid values, and applies median absolute deviation filtering. Spread is retained from pre-filter valid echoes so unstable surfaces are visible.

Example output:

```jsonl
{"type":"started"}
{"type":"tilt","pitch_deg":3.5,"roll_deg":0.4,"still":true}
{"type":"point","angle_deg":0,"distance_cm":42.9,"spread_cm":0.5,"valid_pings":15}
{"type":"point","angle_deg":5,"distance_cm":43.1,"spread_cm":0.6,"valid_pings":14}
{"type":"done"}
{"type":"aimed","angle_deg":40}
{"type":"status_set"}
```

Other events are `ready`, `button`, `stopped`, and `error` with a message. Missing echoes use `distance_cm: null`, not zero. The backend has per-response and 90-second sweep timeouts, rejects malformed points, records missing coverage, and prevents two scans from controlling the rig at once. STOP is accepted during scan waits. It stops the sweep at the current angle; it does not remove motor power. Disconnect power if mechanical interference occurs.

**Expected timing:** approximately 38–45 seconds for a physical sweep, plus AI/camera time. The plan's 15-second sweep cannot retain 555 pings at this spacing. Fewer pings or coarser angles could accelerate a future mode, but require a new accuracy/quality evaluation.

## 6. Run the closed-loop AI demonstration

Add your Google key in Settings and enable DeepAgent + Gemini in the new-scan dialog. A failing or uncertain scan makes the agent call AIM at an anomaly, wait for the acknowledgement/settle time, capture from OpenCV, and ask Gemini to classify the obstruction. If configured, Cloud Vision also provides object-localization annotations.

The rules engine sends PASS/WARN/FAIL to the indicator independently of the model. A model cannot override these measurements. Photos are stored locally, and only enabled AI requests send them to Google.

Use an authorized twin JSON import when comparing an actual building. Place a removable demonstration box near an anomaly angle, run the inspection, remove the box, then rescan. Keep real measured readings and simulated fixtures distinguishable during judging.

## Troubleshooting

- **Port missing:** check a data-capable USB cable, UNO power, board driver, and the port list. Close other serial programs.
- **Connect fails:** verify the uploaded Scout sketch responds to PING with protocol 1. Opening serial resets the UNO, so allow its startup delay.
- **IMU error:** check A4/A5, address 0x68, module power, base stillness, and axis orientation.
- **Erratic distances:** reduce vibration, check stable servo power, align with the actual jambs, and inspect surfaces with poor acoustic reflection. Do not reduce error bounds to force PASS.
- **Camera error:** select the USB camera index and grant camera permission to the host application. Close apps exclusively using that webcam.
- **AI unavailable:** check the saved key, model access, quota/billing, and network. Measurements already obtained remain in the scan. Google failure is shown, never silently replaced with a fake live diagnosis.

## IMU calibration and tare

Upload `firmware/scout_radar/scout_radar.ino` to use the new dashboard capture
controls. It detects MPU-9250 (WHO_AM_I 0x71) or MPU-6050 (0x68), at I2C address
0x68 or 0x69. Boot initializes the accelerometer and performs a stationary check.
It reports `imu_check` and raw gravity-referenced tilt; it never automatically
subtracts the unknown startup surface's slope. An IMU-only `IMU` command captures
25 samples without a radar sweep. Moving, invalid or missing sensor data is rejected.

In **Calibration lab**, connect the Arduino through Settings first, then:

- Use **Read current tilt** for raw signed and saved-bias-corrected values.
- On an independently checked level reference, confirm the level checkbox and
  use **Save known-level zero**. This saves pitch/roll bias in local settings.
- Alternatively use **Capture forward position**, turn the whole base 180 degrees
  on the same plane without changing the IMU mounting, and use **Capture reversed
  position**. Then **Calculate & save bias**. Do not turn only the servo turret.
- Validate error bounds against physical reference measurements before checking
  calibration verified. Saving a new bias clears that verification flag.
- **Tare relative display here** establishes only a temporary display reference.
  Move the rig and press Read current tilt again to see changes relative to that
  surface. It does not change stored calibration or inspection slope measurements.

Do not zero inspection slopes on an unknown ramp or floor. That would hide the
inclination being measured. Bias is corrected once in Python; firmware remains raw.
A startup stillness check is not a full accelerometer scale/alignment calibration.
The IMU must remain rigidly mounted, and a remount requires rechecking calibration.

Firmware validation: compiled for `arduino:avr:uno` with Arduino AVR core 1.8.6
and the official Servo library 1.3.0. If Arduino IDE reports Servo.h missing,
install **Servo** through Library Manager. Compilation does not establish physical
sensor accuracy; verify the assembled rig after upload.

Compatible variants also include MPU-6500 (WHO_AM_I 0x70) and MPU-9255 (0x73).
The connected rig was verified to report 0x70 at I2C address 0x68. Do not reject
that sensor merely because the breakout was sold/labeled as MPU-9250. Firmware
reports identity/address/stability at boot; Settings displays that diagnostic.
IMU read errors distinguish missing identity, I2C failures and nonstationary
acceleration. Device failures inside AI tool calls are reported as hardware
errors rather than being mislabeled as Google service failures.

## Camera check

In Settings → Arduino & camera, select Camera index and click Capture test frame.
Scout captures a fresh local JPEG and displays it with the camera index and capture
time. It tests the selected draft index without saving settings; save changes to
use that index for inspections. No Google/AI request is made by the camera test.
Testing is blocked while an inspection is active. The last successful preview can
be restored after reopening Settings. Camera startup tolerates transient empty
frames and releases the device after capture, including failed attempts.
