from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.config import get_editor_dist_path, get_storage_root
from backend.storage import save_generated_doc


def _load_mock_generated_doc(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "generated_doc.mock.json").read_text(encoding="utf-8")),
    )


def _seed_recording(
    client: TestClient,
    fixtures_dir: Path,
    *,
    with_doc: bool = True,
    screenshot_bytes: bytes = b"\xff\xd8\xffmockjpeg",
) -> str:
    timeline_bytes = (fixtures_dir / "timeline.mock.json").read_bytes()
    response = client.post(
        "/process",
        files={
            "mic": ("mic.webm", b"mic", "audio/webm"),
            "timeline": ("timeline.json", timeline_bytes, "application/json"),
            "screenshots": ("scr-001.jpg", screenshot_bytes, "image/jpeg"),
        },
    )
    assert response.status_code == 200
    recording_id = str(response.json()["recordingId"])

    screenshots_dir = get_storage_root() / recording_id / "screenshots"
    for screenshot_id in ("scr-001", "scr-002", "scr-003"):
        (screenshots_dir / f"{screenshot_id}.jpg").write_bytes(screenshot_bytes)

    if with_doc:
        save_generated_doc(get_storage_root(), recording_id, _load_mock_generated_doc(fixtures_dir))

    return recording_id


def test_get_recording_doc_json(client: TestClient, fixtures_dir: Path) -> None:
    recording_id = _seed_recording(client, fixtures_dir)
    expected = _load_mock_generated_doc(fixtures_dir)

    response = client.get(f"/recording/{recording_id}/doc", params={"format": "json"})
    assert response.status_code == 200
    assert response.json()["title"] == expected["title"]
    assert len(response.json()["steps"]) == len(expected["steps"])


def test_put_recording_doc_persists_changes(client: TestClient, fixtures_dir: Path) -> None:
    recording_id = _seed_recording(client, fixtures_dir)
    doc = _load_mock_generated_doc(fixtures_dir)
    doc["steps"][0]["title"] = "Новый заголовок первого шага"

    put_response = client.put(f"/recording/{recording_id}/doc", json=doc)
    assert put_response.status_code == 200
    assert put_response.json()["steps"][0]["title"] == "Новый заголовок первого шага"

    get_response = client.get(f"/recording/{recording_id}/doc", params={"format": "json"})
    assert get_response.status_code == 200
    assert get_response.json()["steps"][0]["title"] == "Новый заголовок первого шага"


def test_put_recording_doc_invalid_shape_returns_422(
    client: TestClient,
    fixtures_dir: Path,
) -> None:
    recording_id = _seed_recording(client, fixtures_dir)

    response = client.put(f"/recording/{recording_id}/doc", json={"title": "only title"})
    assert response.status_code == 422


def test_get_recording_screenshot(client: TestClient, fixtures_dir: Path) -> None:
    screenshot_bytes = b"\xff\xd8\xffmockjpeg"
    recording_id = _seed_recording(client, fixtures_dir, screenshot_bytes=screenshot_bytes)

    response = client.get(f"/recording/{recording_id}/screenshots/scr-002.jpg")
    assert response.status_code == 200
    assert response.content == screenshot_bytes
    assert response.headers["content-type"].startswith("image/jpeg")


def test_get_recording_screenshot_invalid_name_returns_400(
    client: TestClient,
    fixtures_dir: Path,
) -> None:
    recording_id = _seed_recording(client, fixtures_dir)

    response = client.get(f"/recording/{recording_id}/screenshots/mic.webm")
    assert response.status_code == 400


def test_post_generate_runs_pipeline(client: TestClient, fixtures_dir: Path) -> None:
    recording_id = _seed_recording(client, fixtures_dir, with_doc=False)
    mock_doc = _load_mock_generated_doc(fixtures_dir)

    with patch("backend.routes.recording.run_recording_pipeline", return_value=mock_doc):
        response = client.post(f"/recording/{recording_id}/generate")

    assert response.status_code == 200
    assert response.json()["title"] == mock_doc["title"]

    stored = client.get(f"/recording/{recording_id}/doc", params={"format": "json"})
    assert stored.status_code == 404


def test_get_recording_timeline(client: TestClient, fixtures_dir: Path) -> None:
    recording_id = _seed_recording(client, fixtures_dir, with_doc=False)
    timeline_bytes = (fixtures_dir / "timeline.mock.json").read_bytes()
    expected = json.loads(timeline_bytes.decode("utf-8"))

    response = client.get(f"/recording/{recording_id}/timeline")
    assert response.status_code == 200
    assert response.json()["meta"]["recordingId"] == expected["meta"]["recordingId"]
    assert len(response.json()["events"]) == len(expected["events"])


def test_serve_editor_when_dist_exists(client: TestClient) -> None:
    editor_dist = get_editor_dist_path()
    if not (editor_dist / "index.html").is_file():
        return

    response = client.get("/editor/recording/test-recording-id")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
