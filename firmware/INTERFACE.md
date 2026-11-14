# firmware/: Arduino firmware + Python serial bridge
Owner: Member 2 (see team/OWNERS.txt). Consumers: `agent/` (through the bridge) and `hardware/` (the scenario data the mock uses).
Draft from the master plan. The owner should change it freely and announce changes on the board.

## Hardware (from the plan, 9 wires)
| Part | Pins |
|---|---|
| SG90 servo (turret) | signal D9 |
| HC-SR04 ultrasonic | trig D10, echo D11 |
| GY-521 / MPU-6050 | SDA A4, SCL A5 |
| RGB LED | R D5, G D6 |
| Buzzer | D7 |
| Button | D2 (INPUT_PULLUP, pressed = LOW) |
Angles: **0° = left jamb, 90° = straight ahead, 180° = right jamb.** The webcam sits on the turret and points wherever the servo points.

## Serial protocol (USB, 115200 baud)
Laptop → Arduino: one ASCII command per line. Arduino → laptop: **one JSON object per line**.
On boot the Arduino sends `{"type":"ready","fw":"scout-fw 0.1"}`.

| Command | Replies |
|---|---|
| `PING` | `{"type":"pong"}` |
| `SCAN` | 1. Stillness check. If the box is moving, send `{"type":"error","code":"not_still"}` and stop.<br>2. `{"type":"tilt","pitch_deg":3.4,"roll_deg":0.6}`, where pitch = atan2(ax, √(ay²+az²)) and roll = atan2(ay, √(ax²+az²))<br>3. Sweep 0→180 in 5° steps, 15 pings each with outliers dropped: `{"type":"point","angle":40,"cm":36.2,"spread_cm":4.1,"n":15}` (37 lines)<br>4. `{"type":"scan_end"}` |
| `TILT` | `{"type":"tilt",...}` only (used for the 180° flip calibration) |
| `AIM <angle>` | Moves the servo and lets it settle. `{"type":"aimed","angle":40}` |
| `STATUS <PASS\|WARN\|FAIL\|BUSY\|IDLE>` | `{"type":"ok"}`. PASS is green plus 1 beep, WARN yellow, FAIL red plus 3 beeps, BUSY blinks |
| unsolicited | `{"type":"button"}` when D2 is pressed |
Errors: `{"type":"error","code":"bad_angle"}` and so on. `cm` is `-1` when there's no echo.

## Python bridge: `firmware/bridge/scout_serial.py`
**Only this class opens the serial port.** Everything else goes through it.
```python
from firmware.bridge.scout_serial import ScoutSerial
s = ScoutSerial(port=None)            # auto-detects /dev/cu.usbmodem*; SCOUT_MOCK=1 means no Arduino needed
s.scan(on_point=None) -> {"tilt": {...}, "points": [{"angle":0,"cm":..,"spread_cm":..}, ...]}
s.tilt() -> {"pitch_deg": .., "roll_deg": ..}
s.aim(angle: int) -> None
s.status(state: str) -> None
s.wait_button(timeout: float | None = None) -> bool
```
Mock mode (`SCOUT_MOCK=1`) replays `hardware/scenarios/$SCOUT_SCENARIO.json` (default `fail_29in_box`), with small random noise, at real-ish speed.

## Backlog (in order; take the next one when idle)
1. Bridge with mock mode working against the scenario files. This unblocks agent/ and hud/ first, so post DONE right away.
2. Firmware: PING, STATUS, AIM, button event.
3. Firmware: SCAN with tilt, stillness check and median-of-15 pings.
4. Real hardware test: bridge ↔ Arduino, then post DONE.
5. Robustness: auto-reconnect, timeouts, clear errors if the USB is unplugged mid-demo.
