import asyncio
import math
import uuid
from . import db, rules, vision, inspections
from .config import config, DATA
from .hardware import SerialDevice, Simulator, capture_camera, DeviceError
from .models import ScanRequest
from .ai_errors import describe_ai_error


class Inspection:
    def __init__(self, doc, device):
        self.doc = doc
        self.request = ScanRequest.model_validate(doc["request"])
        self.twin = doc["twin"]
        self.settings = doc["settings_snapshot"]
        # Secret values stay in this ephemeral context, never scan records.
        self.settings = self.settings | {
            k: config.snapshot()[k] for k in ("gemini_api_key", "google_vision_api_key")
        }
        self.device = device
        self.captures = 0
        self.sweep_lock = asyncio.Lock()
        self.capture_lock = asyncio.Lock()
        self.diagnosis_lock = asyncio.Lock()
        self.publish_lock = asyncio.Lock()
        self.diagnoses = {}

    async def emit(self, kind, data):
        db.add_event(self.doc["id"], kind, data)

    async def sweep(self):
        async with self.sweep_lock:
            await self._sweep()

    async def _sweep(self):
        if self.doc.get("result"):
            return
        await self.emit(
            "stage",
            {
                "stage": "scanning",
                "message": "Checking stillness and sweeping 37 angles.",
            },
        )
        points, tilt = await self.device.sweep(self.emit)
        self.doc["points"] = points
        self.doc["tilt"] = tilt
        self.doc["result"] = rules.evaluate(
            points, tilt, self.request, self.settings, self.twin
        )
        db.save_scan(self.doc)
        await self.device.verdict(self.doc["result"]["verdict"])
        await self.emit("result", self.doc["result"])

    def inspection_required(self):
        r = self.doc.get("result", {})
        return r.get("verdict") in ("FAIL", "VERIFY") or bool(r.get("noisy_angles"))

    async def capture(self, angle):
        async with self.capture_lock:
            return await self._capture(angle)

    async def _capture(self, angle):
        if not self.doc.get("result"):
            raise DeviceError("Run a sweep before aiming.")
        if not math.isfinite(angle) or not 0 <= angle <= 180:
            raise DeviceError("Angle outside allowed range.")
        if self.captures >= 3:
            raise DeviceError("Capture limit reached for this scan.")
        self.captures += 1
        await self.emit(
            "stage",
            {
                "stage": "inspecting",
                "message": f"Aiming turret at {angle:.0f}° for visual inspection.",
                "angle_deg": angle,
            },
        )
        await self.device.aim(angle)
        await asyncio.sleep(0.2)
        image_id = f"{self.doc['id']}-{self.captures}.jpg"
        path = DATA / "images" / image_id
        if self.request.mode == "demo":
            self.device.capture(path, angle)
        else:
            await asyncio.to_thread(capture_camera, self.settings["camera_index"], path)
        self.doc.setdefault("images", []).append(
            dict(
                id=image_id,
                url=f"/api/images/{image_id}",
                angle_deg=angle,
                simulated=self.request.mode == "demo",
            )
        )
        db.save_scan(self.doc)
        await self.emit("capture", self.doc["images"][-1])
        return image_id

    async def diagnose(self, image_id):
        async with self.diagnosis_lock:
            if image_id not in self.diagnoses:
                self.diagnoses[image_id] = await self._diagnose(image_id)
            return self.diagnoses[image_id]

    async def _diagnose(self, image_id):
        if image_id not in [i["id"] for i in self.doc.get("images", [])]:
            raise DeviceError("Image does not belong to this inspection.")
        await self.emit(
            "tool",
            {
                "name": "analyze_obstruction_with_gemini",
                "message": "Inspecting image with Google Gemini Vision.",
            },
        )
        result = await vision.analyze(
            DATA / "images" / image_id, self.doc["result"], self.settings
        )
        if self.request.mode == "demo":
            result["limitations"] = (
                "Input image is a simulated illustration, not real evidence. "
                + result["limitations"]
            )
        self.doc["diagnosis"] = result
        db.save_scan(self.doc)
        await self.emit("diagnosis", result)
        return result

    async def publish(self, summary=""):
        async with self.publish_lock:
            await self._publish(summary)

    async def _publish(self, summary=""):
        if self.doc.get("work_order"):
            return
        r = self.doc["result"]
        actions = []
        for c in r["checks"]:
            if c["status"] in ("FAIL", "VERIFY"):
                if c["key"] == "width":
                    text = "Clear movable obstructions, measure the opening with the door at 90°, and rescan. Have a qualified contractor assess structural or door-hardware changes."
                    cost = [0, 500]
                elif c["key"] in ("running_slope", "cross_slope"):
                    text = "Verify with a calibrated inclinometer; have facilities assess leveling or reconstruction, drainage, and ramp geometry."
                    cost = [150, 2500]
                else:
                    text = "Verify the manual dimension and have a qualified contractor evaluate accessible replacement or adjustment."
                    cost = [50, 750]
                actions.append(
                    dict(
                        title=c["label"],
                        detail=text,
                        priority="high" if c["status"] == "FAIL" else "review",
                        estimate_low=cost[0],
                        estimate_high=cost[1],
                        rule=c["section"],
                    )
                )
        if r["issues"]:
            actions.append(
                dict(
                    title="Verify measurement quality",
                    detail=" ".join(r["issues"]),
                    priority="review",
                    estimate_low=0,
                    estimate_high=150,
                    rule="Measurement quality",
                )
            )
        diagnosis = self.doc.get("diagnosis")
        if diagnosis:
            for rec in diagnosis.get("recommendations", [])[:4]:
                actions.append(
                    dict(
                        title="Visual inspection recommendation",
                        detail=rec,
                        priority="review",
                        estimate_low=None,
                        estimate_high=None,
                        rule="AI suggestion · human review",
                    )
                )
        if not actions:
            actions.append(
                dict(
                    title="Record and maintain clear access",
                    detail="Measured checks passed. Review unmeasured dimensions and retain this scan as a dated observation.",
                    priority="routine",
                    estimate_low=0,
                    estimate_high=0,
                    rule="Measured scope",
                )
            )
        self.doc["work_order"] = dict(
            id="WO-" + self.doc["id"][:8].upper(),
            created_at=db.now(),
            status="open",
            assignee="",
            notes="",
            summary=summary
            or (
                "Measured checks passed."
                if r["verdict"] == "PASS"
                else "Review flagged dimensions and complete corrective work before reinspection."
            ),
            actions=actions,
            cost_note="Illustrative planning ranges in USD, not contractor quotes. Overlapping items are not additive. Site conditions, labor, permits, and structural work can change costs.",
        )
        await self.device.verdict(r["verdict"])
        db.save_scan(self.doc)
        await self.emit("work_order", self.doc["work_order"])

    async def deterministic_flow(self):
        await self.emit(
            "agent",
            {
                "message": "Running deterministic inspection workflow. AI is disabled.",
                "provider": "deterministic",
            },
        )
        await self.sweep()
        if self.inspection_required():
            angles = self.doc["result"]["noisy_angles"]
            angle = 40 if 40 in angles else angles[0] if angles else 0
            try:
                await self.capture(angle)
                if self.request.mode == "demo":
                    obstructed = self.request.scenario in ("obstructed", "noisy")
                    self.doc["diagnosis"] = dict(
                        obstruction="Demonstration staging box"
                        if obstructed
                        else "No simulated obstruction",
                        classification="temporary" if obstructed else "none",
                        confidence=1,
                        observations=[
                            "Scenario fixture, not a live AI classification."
                        ],
                        recommendations=[
                            "Remove the demonstration box and run the clear scenario."
                        ]
                        if obstructed
                        else [],
                        limitations="Simulated image and diagnosis. Enable Gemini for actual visual analysis.",
                        provider="simulation",
                        objects=[],
                        cloud_vision_status="not_used",
                    )
                    await self.emit("diagnosis", self.doc["diagnosis"])
                else:
                    await self.emit(
                        "notice",
                        {
                            "message": "Frame captured. Enable AI for Gemini diagnosis; manual visual review required."
                        },
                    )
            except DeviceError as exc:
                await self.emit("notice", {"message": str(exc)})
                self.doc.setdefault("warnings", []).append(str(exc))
        await self.publish()


class ScanManager:
    def __init__(self):
        self.device = SerialDevice()
        self.active_id = None
        self.task = None
        self.lock = asyncio.Lock()
        self.device.button_callback = self.button

    async def button(self):
        s = config.snapshot()
        if not s["button_enabled"] or self.active_id:
            return
        try:
            await self.start(
                ScanRequest(
                    building_id=s["button_building_id"],
                    mode="hardware",
                    profile=s["button_profile"],
                    use_ai=s["button_use_ai"],
                )
            )
        except (ValueError, DeviceError):
            pass

    async def start(self, request):
        async with self.lock:
            if self.active_id:
                raise ValueError("An inspection is already running.")
            twin = db.get_twin(request.building_id)
            if not twin:
                raise KeyError("Digital twin not found.")
            settings = config.public()
            if request.use_ai and not settings["gemini_api_key_configured"]:
                raise ValueError("Add a Gemini API key in Settings before enabling AI.")
            if request.mode == "hardware":
                await self.device.connect(settings["serial_port"])
            doc = dict(
                id=str(uuid.uuid4()),
                created_at=db.now(),
                status="queued",
                request=request.model_dump(),
                twin=twin,
                settings_snapshot=settings,
                points=[],
                images=[],
                agent_provider="deepagents" if request.use_ai else "deterministic",
            )
            db.save_scan(doc)
            self.active_id = doc["id"]
            self.task = asyncio.create_task(self.run(doc))
            return doc

    async def run(self, doc):
        device = (
            Simulator(doc["request"]["scenario"])
            if doc["request"]["mode"] == "demo"
            else self.device
        )
        ctx = Inspection(doc, device)
        try:
            doc["status"] = "running"
            db.save_scan(doc)
            if ctx.request.use_ai:
                from .agent import run_deep_agent

                try:
                    await run_deep_agent(ctx)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    # Never expose provider exceptions (may include credentials or request payloads).
                    doc["ai_error"] = describe_ai_error(exc)
                    await ctx.emit(
                        "notice",
                        {"message": doc["ai_error"], "error_type": type(exc).__name__},
                    )
                    if not doc.get("result"):
                        raise DeviceError(doc["ai_error"]) from exc
                    if not doc.get("work_order"):
                        await ctx.publish(
                            "AI diagnosis unavailable. Review measurements and captured evidence manually."
                        )
            else:
                await ctx.deterministic_flow()
            doc["status"] = "completed"
        except asyncio.CancelledError:
            await device.stop()
            doc["status"] = "cancelled"
            doc["error"] = "Inspection cancelled by operator."
        except Exception as exc:
            await device.stop()
            doc["status"] = "failed"
            doc["error"] = (
                str(exc)
                if isinstance(exc, DeviceError)
                else "Inspection failed. Check device connection and configuration, then retry."
            )
        finally:
            doc["completed_at"] = db.now()
            if doc["status"] == "completed":
                doc["atlas_status"] = "saving"
                try:
                    doc["atlas_inspection_id"] = await inspections.save_completed_scan(
                        doc
                    )
                    doc["atlas_status"] = "saved"
                except Exception:
                    # Retain local evidence even when Atlas is unavailable. Never expose driver errors.
                    doc["atlas_status"] = "failed"
                    doc["atlas_error"] = (
                        "Atlas save failed. Your inspection remains saved locally. Check MongoDB configuration."
                    )
            db.save_scan(doc)
            await ctx.emit(
                "complete", {"status": doc["status"], "error": doc.get("error")}
            )
            self.active_id = None

    async def cancel(self, id):
        if self.active_id != id or not self.task:
            raise ValueError("This inspection is not running.")
        self.task.cancel()
        await self.task

    async def close(self):
        if self.task and not self.task.done():
            self.task.cancel()
            await self.task
        await self.device.close()


manager = ScanManager()
