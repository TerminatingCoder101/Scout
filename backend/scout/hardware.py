import asyncio
import json
import math
import time
from .models import Point


class DeviceError(RuntimeError):
    pass


class SerialDevice:
    """One reader owns the serial stream; scan and button events never race."""

    def __init__(self):
        self.serial = None
        self.port = None
        self.reader = None
        self.queue = asyncio.Queue(maxsize=1024)
        self.button_callback = None
        self.button_task = None
        self.command_lock = asyncio.Lock()
        self.last_error = None

    async def connect(self, port):
        if (
            self.serial
            and self.port == port
            and self.serial.is_open
            and self.reader
            and not self.reader.done()
        ):
            return
        await self.close()
        if not port:
            raise DeviceError("Select a serial port in Settings first.")
        import serial

        try:
            self.serial = await asyncio.to_thread(
                serial.Serial, port, 115200, timeout=0.2, write_timeout=1
            )
            self.port = port
            await asyncio.sleep(2)  # UNO resets when DTR opens.
            self.reader = asyncio.create_task(self._read())
            self.last_error = None
            await self.send("PING")
            for _ in range(5):
                event = await self.next(timeout=3)
                if event.get("type") == "ready" and event.get("protocol") == 1:
                    break
            else:
                raise DeviceError(
                    "Scout firmware did not acknowledge protocol version 1."
                )
        except Exception as exc:
            await self.close()
            self.last_error = "Unable to connect to Scout firmware. Check USB, flash the sketch, and close Serial Monitor."
            raise DeviceError(self.last_error) from exc

    async def _read(self):
        try:
            while self.serial and self.serial.is_open:
                raw = await asyncio.to_thread(self.serial.read_until, b"\n", 2048)
                if not raw:
                    continue
                try:
                    event = json.loads(raw)
                    if not isinstance(event, dict):
                        continue
                except (ValueError, UnicodeDecodeError):
                    continue
                if event.get("type") == "button":
                    if self.button_callback and (
                        self.button_task is None or self.button_task.done()
                    ):
                        self.button_task = asyncio.create_task(self.button_callback())
                elif not self.queue.full():
                    self.queue.put_nowait(event)
        except asyncio.CancelledError:
            raise
        except Exception:
            self.last_error = "Serial connection lost."
            if not self.queue.full():
                self.queue.put_nowait({"type": "error", "message": self.last_error})

    async def close(self):
        if self.reader:
            self.reader.cancel()
            try:
                await self.reader
            except asyncio.CancelledError:
                pass
            self.reader = None
        if self.serial:
            await asyncio.to_thread(self.serial.close)
        self.serial = None
        self.port = None
        self.drain()

    def drain(self):
        while not self.queue.empty():
            self.queue.get_nowait()

    async def send(self, command):
        if not self.serial or not self.serial.is_open:
            raise DeviceError("Arduino is disconnected.")
        try:
            await asyncio.to_thread(self.serial.write, (command + "\n").encode("ascii"))
        except Exception as exc:
            raise DeviceError("Unable to send command to Arduino.") from exc

    async def next(self, timeout=5):
        try:
            event = await asyncio.wait_for(self.queue.get(), timeout)
        except asyncio.TimeoutError as exc:
            raise DeviceError("Arduino response timed out.") from exc
        if event.get("type") == "error":
            raise DeviceError(str(event.get("message", "Device error"))[:200])
        return event

    async def sweep(self, emit):
        async with self.command_lock:
            self.drain()
            await self.send("SCAN")
            points = []
            tilt = {"pitch_deg": None, "roll_deg": None, "still": False}
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                e = await self.next(timeout=10)
                if e.get("type") == "tilt":
                    pitch = e.get("pitch_deg")
                    roll = e.get("roll_deg")
                    if (
                        not isinstance(pitch, (int, float))
                        or not isinstance(roll, (int, float))
                        or not math.isfinite(pitch)
                        or not math.isfinite(roll)
                        or abs(pitch) > 90
                        or abs(roll) > 90
                    ):
                        raise DeviceError("Invalid IMU readings received.")
                    tilt = dict(
                        pitch_deg=pitch, roll_deg=roll, still=e.get("still") is True
                    )
                    await emit("tilt", tilt)
                elif e.get("type") == "point":
                    p = Point.model_validate(
                        {
                            k: e[k]
                            for k in (
                                "angle_deg",
                                "distance_cm",
                                "spread_cm",
                                "valid_pings",
                            )
                            if k in e
                        }
                    ).model_dump()
                    if any(x["angle_deg"] == p["angle_deg"] for x in points):
                        continue
                    points.append(p)
                    await emit("point", p)
                elif e.get("type") == "done":
                    if not points:
                        raise DeviceError("No radar readings received.")
                    return points, tilt
            raise DeviceError("Sweep exceeded 90 seconds.")

    async def aim(self, angle):
        if not math.isfinite(angle) or not 0 <= angle <= 180:
            raise DeviceError("Aim angle must be between 0 and 180 degrees.")
        async with self.command_lock:
            self.drain()
            await self.send(f"AIM {round(angle)}")
            for _ in range(10):
                e = await self.next()
                if e.get("type") == "aimed":
                    return
            raise DeviceError("No aim acknowledgement received.")

    async def verdict(self, status):
        await self.send(
            "STATUS " + {"PASS": "PASS", "VERIFY": "WARN", "FAIL": "FAIL"}[status]
        )

    async def stop(self):
        if self.serial:
            try:
                await self.send("STOP")
            except DeviceError:
                pass

    def status(self):
        return dict(
            connected=bool(
                self.serial
                and self.serial.is_open
                and self.reader
                and not self.reader.done()
            ),
            port=self.port,
            error=self.last_error,
        )


class Simulator:
    def __init__(self, scenario, delay=0.07):
        self.scenario = scenario
        self.delay = delay

    async def sweep(self, emit):
        width = {"obstructed": 29.1, "clear": 36.8, "borderline": 32.1, "noisy": 34.0}[
            self.scenario
        ] * 2.54
        tilt = dict(
            pitch_deg=3.5,
            roll_deg=2.1 if self.scenario == "obstructed" else 0.4,
            still=True,
        )
        await emit("tilt", tilt)
        points = []
        for angle in range(0, 181, 5):
            radial = min(
                210, (width / 2) / max(abs(math.cos(math.radians(angle))), 0.16)
            )
            anomaly = self.scenario in ("obstructed", "noisy") and 30 <= angle <= 50
            if anomaly:
                radial = 35 + (angle - 40) ** 2 / 25
            p = dict(
                angle_deg=angle,
                distance_cm=round(radial, 2),
                spread_cm=7.5 if anomaly else 0.4,
                valid_pings=10 if anomaly else 15,
            )
            points.append(p)
            await emit("point", p)
            await asyncio.sleep(self.delay)
        return points, tilt

    async def aim(self, angle):
        await asyncio.sleep(self.delay)

    async def verdict(self, status):
        pass

    async def stop(self):
        pass

    def capture(self, path, angle):
        from PIL import Image, ImageDraw

        im = Image.new("RGB", (1000, 620), "#26302d")
        d = ImageDraw.Draw(im)
        d.polygon([(300, 120), (700, 120), (880, 580), (120, 580)], fill="#57635d")
        d.rectangle((250, 65, 300, 600), fill="#c0c7bd")
        d.rectangle((700, 65, 750, 600), fill="#c0c7bd")
        d.rectangle((250, 65, 750, 115), fill="#d0d6cd")
        if self.scenario in ("obstructed", "noisy"):
            d.rectangle(
                (320, 340, 535, 535), fill="#a77d47", outline="#d1b183", width=4
            )
            d.line((427, 340, 427, 535), fill="#d1b183", width=6)
            d.rectangle((300, 320, 545, 550), outline="#c2ee92", width=3)
            d.text((310, 298), "SIMULATED OBSTRUCTION", fill="#c2ee92")
        d.rectangle((0, 0, 1000, 45), fill="#111a15")
        d.text(
            (20, 16),
            f"SIMULATED CAMERA FRAME / {angle:.0f} DEG / NOT PHOTOGRAPHIC EVIDENCE",
            fill="#d4e9d4",
        )
        im.save(path, "JPEG", quality=90)


def capture_camera(index, path):
    import cv2

    cap = cv2.VideoCapture(index)
    try:
        if not cap.isOpened():
            raise DeviceError(
                "Camera unavailable. Check the index and camera permission."
            )
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        frame = None
        for _ in range(6):
            ok, frame = cap.read()
            if not ok:
                raise DeviceError("Camera did not return a frame.")
        if not cv2.imwrite(str(path), frame):
            raise DeviceError("Unable to save camera frame.")
    finally:
        cap.release()


def ports():
    from serial.tools import list_ports

    return [
        dict(device=p.device, description=p.description) for p in list_ports.comports()
    ]
