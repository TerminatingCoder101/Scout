import base64
import json
from types import SimpleNamespace
import pytest
import httpx
from scout import vision


@pytest.mark.asyncio
async def test_cloud_vision_http_contract(monkeypatch):
    captured = []

    def handler(request):
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "responses": [
                    {
                        "localizedObjectAnnotations": [
                            {
                                "name": "Box",
                                "score": 0.97,
                                "boundingPoly": {
                                    "normalizedVertices": [{"x": 0.2, "y": 0.4}]
                                },
                            }
                        ]
                    }
                ]
            },
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        vision.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    result = await vision.cloud_objects(b"image-bytes", "cloud-key")
    assert result[0]["name"] == "Box"
    assert captured[0].headers["x-goog-api-key"] == "cloud-key"
    assert "cloud-key" not in str(captured[0].url)
    body = json.loads(captured[0].content)
    assert body["requests"][0]["features"][0]["type"] == "OBJECT_LOCALIZATION"
    assert base64.b64decode(body["requests"][0]["image"]["content"]) == b"image-bytes"


@pytest.mark.asyncio
async def test_gemini_multimodal_contract_and_cloud_failure(monkeypatch, tmp_path):
    from google import genai

    received = []
    diagnosis = dict(
        obstruction="Box",
        classification="temporary",
        confidence=0.85,
        observations=["Visible box"],
        recommendations=["Remove and rescan"],
        limitations="Cannot measure from photo",
    )

    class FakeAsync:
        def __init__(self):
            self.models = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def generate_content(self, **kwargs):
            received.append(kwargs)
            return SimpleNamespace(text=json.dumps(diagnosis))

    class FakeClient:
        def __init__(self, **kwargs):
            self.aio = FakeAsync()

        def close(self):
            pass

    monkeypatch.setattr(genai, "Client", FakeClient)

    async def unavailable(*args):
        raise RuntimeError("service unavailable")

    monkeypatch.setattr(vision, "cloud_objects", unavailable)
    path = tmp_path / "frame.jpg"
    path.write_bytes(b"fake-jpeg")
    result = await vision.analyze(
        path,
        {"width_in": 29.1},
        {
            "gemini_api_key": "test",
            "google_vision_api_key": "test-cloud",
            "gemini_model": "test-model",
        },
    )
    assert result["provider"] == "google_gemini"
    assert result["cloud_vision_status"] == "unavailable"
    assert received[0]["model"] == "test-model"
    assert received[0]["contents"][1].inline_data.data == b"fake-jpeg"
    schema = received[0]["config"].response_schema
    assert "additionalProperties" not in schema
    assert "obstruction" in schema["properties"]


@pytest.mark.asyncio
async def test_cloud_error_not_silently_successful(monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        vision.httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200, json={"responses": [{"error": {"message": "Denied"}}]}
                )
            ),
            **kwargs,
        ),
    )
    with pytest.raises(RuntimeError):
        await vision.cloud_objects(b"image", "key")
