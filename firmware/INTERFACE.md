# firmware/ interface: Arduino ⇄ Pi serial protocol
Owner: see team/OWNERS.txt. The consumer is `pi/`. This is a starting draft, so the owner should change it freely and announce it on the board.

## Link
- USB serial, **115200 baud**, 8N1.
- ASCII, one command per line, terminated by `\n` (ignore `\r`).
- Each command gets exactly one reply line, except `SWEEP`, which streams.
- On boot the Arduino prints `READY scout-fw <version>`.
- Errors: `ERR <reason>`, for example `ERR bad_angle` or `ERR no_echo`.

## Commands (Pi → Arduino)
| Command | Reply | Notes |
|---|---|---|
| `PING` | `PONG` | Health check. |
| `DIST <angle>` | `DIST <angle> <cm>` | Move the servo to 0–180°, settle, then return the median of 5 ultrasonic pings in cm, 1 decimal place. `-1` means no echo. |
| `SWEEP <start> <end> <step>` | `SWEEP <angle> <cm>` per step, then `SWEEP_END` | Defaults to `0 180 10` if there are no args. |
| `TILT` | `TILT <pitch_deg> <roll_deg>` | From the gyro/accelerometer, averaged over about 200 ms. Pitch is positive nose-up (running slope) and roll is positive right-side-down (cross slope). |
| `ZERO` | `OK` | Saves the current tilt as level (calibration on a flat floor). |
| `STATUS <PASS\|FAIL\|WORKING\|IDLE>` | `OK` | LED colour plus buzzer pattern. FAIL gives 3 short beeps, PASS 1 long beep. |
| `LCD <text>` | `OK` | Up to 2×16 chars. Use `\|` to split the lines, e.g. `LCD Door 30.5in\|FAIL <32`. |

## Events (Arduino → Pi, unsolicited)
| Line | Meaning |
|---|---|
| `BUTTON` | The start button was pressed. It replaces RFID, which was cut. |

## Geometry the Pi needs
- Servo angle 0° = robot's right, 90° = straight ahead, 180° = left.
- `SENSOR_OFFSET_CM`: the distance from the servo pivot to each side of the chassis. Measure it and write it here: **TBD**.

## Mock
`pi/` simulates this protocol when `SCOUT_MOCK=1`, so nobody waits on hardware.
