from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scout import hardware


def test_camera_tolerates_transient_empty_frames(monkeypatch, tmp_path):
    import cv2

    frame = SimpleNamespace(size=100)
    cap = Mock()
    cap.read.side_effect = [
        (False, None),
        (True, frame),
        (False, None),
        (True, frame),
        (True, frame),
    ]
    monkeypatch.setattr(cv2, "VideoCapture", Mock(return_value=cap))
    write = Mock(return_value=True)
    monkeypatch.setattr(cv2, "imwrite", write)
    hardware.capture_camera(0, tmp_path / "photo.jpg")
    write.assert_called_once_with(str(tmp_path / "photo.jpg"), frame)
    cap.release.assert_called_once()


def test_camera_reopens_and_reports_unavailable(monkeypatch, tmp_path):
    import cv2

    cap = Mock()
    cap.isOpened.return_value = False
    factory = Mock(return_value=cap)
    monkeypatch.setattr(cv2, "VideoCapture", factory)
    with pytest.raises(hardware.DeviceError, match="Camera 2 could not open"):
        hardware.capture_camera(2, tmp_path / "photo.jpg")
    assert factory.call_count == 2
    assert cap.release.call_count == 2
    assert not (tmp_path / "photo.jpg").exists()


def test_camera_preview_endpoint(client, monkeypatch):
    from scout import main

    captured = []

    def capture(index, path):
        captured.append(index)
        path.write_bytes(b"test jpeg")

    monkeypatch.setattr(main, "capture_camera", capture)
    response = client.post("/api/hardware/test-camera")
    assert response.status_code == 200
    assert client.get("/api/hardware/camera-preview").json() == response.json()
    assert response.json()["captured_at"]
    assert client.get(response.json()["url"]).content == b"test jpeg"
    selected = client.post("/api/hardware/test-camera", json={"camera_index": 2})
    assert selected.status_code == 200 and selected.json()["camera_index"] == 2
    assert captured[-1] == 2
    assert (
        client.post("/api/hardware/test-camera", json={"camera_index": 11}).status_code
        == 422
    )
    main.manager.active_id = "busy"
    try:
        assert client.post("/api/hardware/test-camera").status_code == 409
    finally:
        main.manager.active_id = None

    def fail(index, path):
        raise hardware.DeviceError("Camera 0 did not deliver a frame.")

    monkeypatch.setattr(main, "capture_camera", fail)
    response = client.post("/api/hardware/test-camera")
    assert response.status_code == 400
    assert "Camera 0" in response.json()["detail"]
