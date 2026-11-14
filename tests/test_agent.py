"""Runs the real compiled DeepAgent with a scripted model; no paid API calls."""

import json
import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatResult, ChatGeneration
from scout.config import config
from scout.service import Inspection
from scout.hardware import Simulator
from scout.models import ScanRequest
from scout import db, vision
from scout.agent import run_deep_agent


class ToolSequenceModel(BaseChatModel):
    @property
    def _llm_type(self):
        return "scripted-scout-test"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        done = [m.name for m in messages if isinstance(m, ToolMessage)]
        if "get_digital_twin_specs" not in done:
            name, args = "get_digital_twin_specs", {"building_id": "princeton-demo"}
        elif "execute_hardware_sweep" not in done:
            name, args = "execute_hardware_sweep", {}
        elif "aim_turret_and_capture" not in done:
            name, args = "aim_turret_and_capture", {"angle_deg": 40}
        elif "analyze_obstruction_with_gemini" not in done:
            image = next(
                m.content
                for m in messages
                if isinstance(m, ToolMessage) and m.name == "aim_turret_and_capture"
            )
            name, args = "analyze_obstruction_with_gemini", {"image_id": image}
        elif "publish_verdict_and_work_order" not in done:
            name, args = (
                "publish_verdict_and_work_order",
                {
                    "summary": "Measured failure; remove the observed obstruction and reinspect."
                },
            )
        else:
            raise AssertionError(
                "Publishing must finish the run without another model request"
            )
        return ChatResult(
            generations=[
                ChatGeneration(
                    message=AIMessage(
                        content="",
                        tool_calls=[
                            {"name": name, "args": args, "id": "call-" + str(len(done))}
                        ],
                    )
                )
            ]
        )


@pytest.mark.asyncio
async def test_real_deepagent_tool_loop(monkeypatch):
    import langchain_google_genai

    monkeypatch.setattr(
        langchain_google_genai,
        "ChatGoogleGenerativeAI",
        lambda **kwargs: ToolSequenceModel(),
    )
    calls = []

    async def fake_analyze(path, radar, settings):
        assert path.exists() and radar["verdict"] == "FAIL"
        calls.append(path)
        return dict(
            obstruction="Box",
            classification="temporary",
            confidence=0.9,
            observations=["Box in doorway"],
            recommendations=["Remove box and rescan"],
            limitations="Mock vision response",
            provider="google_gemini",
            cloud_vision_status="not_configured",
            objects=[],
        )

    monkeypatch.setattr(vision, "analyze", fake_analyze)
    db.init()
    config.update({"gemini_api_key": "fake-key"})
    request = ScanRequest(use_ai=True)
    doc = dict(
        id="11111111-1111-1111-1111-111111111111",
        created_at=db.now(),
        status="running",
        request=request.model_dump(),
        twin=db.get_twin("princeton-demo"),
        settings_snapshot=config.public(),
        points=[],
        images=[],
        agent_provider="deepagents",
    )
    db.save_scan(doc)
    ctx = Inspection(doc, Simulator("obstructed", delay=0))
    await run_deep_agent(ctx)
    assert len(calls) == 1
    assert doc["result"]["verdict"] == "FAIL"
    assert doc["work_order"]["summary"].startswith("Measured failure")
    assert len(doc["points"]) == 37
    assert doc["diagnosis"]["provider"] == "google_gemini"
    assert "fake-key" not in json.dumps(db.get_scan(doc["id"]))


@pytest.mark.asyncio
async def test_parallel_sweep_calls_reuse_one_acquisition():
    import asyncio

    db.init()
    request = ScanRequest()
    doc = dict(
        id="22222222-2222-2222-2222-222222222222",
        created_at=db.now(),
        status="running",
        request=request.model_dump(),
        twin=db.get_twin("princeton-demo"),
        settings_snapshot=config.public(),
        points=[],
        images=[],
        agent_provider="deterministic",
    )
    db.save_scan(doc)
    ctx = Inspection(doc, Simulator("clear", delay=0))
    await asyncio.gather(ctx.sweep(), ctx.sweep())
    assert len([e for e in db.events(doc["id"]) if e["kind"] == "point"]) == 37
    await asyncio.gather(ctx.publish(), ctx.publish())
    assert len([e for e in db.events(doc["id"]) if e["kind"] == "work_order"]) == 1
