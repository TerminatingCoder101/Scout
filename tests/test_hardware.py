import asyncio
import pytest
from scout.hardware import SerialDevice, DeviceError


@pytest.mark.asyncio
async def test_serial_protocol_and_bad_angles():
    device = SerialDevice()
    sent = []

    async def send(cmd):
        sent.append(cmd)
        if cmd == "SCAN":
            for e in [
                {"type": "started"},
                {"type": "tilt", "pitch_deg": 3.5, "roll_deg": 0.4, "still": True},
                {
                    "type": "point",
                    "angle_deg": 0,
                    "distance_cm": 40,
                    "spread_cm": 0.5,
                    "valid_pings": 15,
                },
                {"type": "done"},
            ]:
                await device.queue.put(e)
        elif cmd.startswith("AIM"):
            await device.queue.put({"type": "aimed", "angle_deg": 40})

    device.send = send
    events = []

    async def emit(k, d):
        events.append((k, d))

    points, tilt = await device.sweep(emit)
    assert len(points) == 1 and tilt["still"] and sent == ["SCAN"]
    await device.aim(40)
    await device.verdict("VERIFY")
    assert sent[-2:] == ["AIM 40", "STATUS WARN"]
    with pytest.raises(DeviceError):
        await device.aim(181)
    with pytest.raises(DeviceError):
        await device.aim(float("nan"))


@pytest.mark.asyncio
async def test_timeout_and_device_error():
    device = SerialDevice()
    with pytest.raises(DeviceError, match="timed out"):
        await device.next(0.01)
    await device.queue.put({"type": "error", "message": "Disconnected"})
    with pytest.raises(DeviceError, match="Disconnected"):
        await device.next()
