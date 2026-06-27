from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.config import get_storage_root
from backend.models import Job, Recording, get_session_factory


def test_post_process_accepts_mock_artifacts(
    client: TestClient,
    fixtures_dir: Path,
    tmp_path: Path,
) -> None:
    timeline_path = fixtures_dir / "timeline.mock.json"
    timeline_bytes = timeline_path.read_bytes()
    mic_bytes = b"mock-mic-webm-content"
    screenshot_bytes = b"\xff\xd8\xffmockjpeg"

    response = client.post(
        "/process",
        files={
            "mic": ("mic.webm", mic_bytes, "audio/webm"),
            "timeline": ("timeline.json", timeline_bytes, "application/json"),
            "screenshots": ("scr-001.jpg", screenshot_bytes, "image/jpeg"),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["recordingId"] == "rec-mock-client-create"
    assert payload["status"] == "received"
    assert payload["jobId"].startswith("job-")

    storage_root = get_storage_root()
    recording_dir = storage_root / "rec-mock-client-create"
    assert (recording_dir / "mic.webm").read_bytes() == mic_bytes
    assert (recording_dir / "timeline.json").exists()
    assert (recording_dir / "screenshots" / "scr-001.jpg").read_bytes() == screenshot_bytes

    session = get_session_factory()()
    try:
        recording = session.execute(
            select(Recording).where(Recording.recording_id == "rec-mock-client-create"),
        ).scalar_one()
        job = session.execute(
            select(Job).where(Job.job_id == payload["jobId"]),
        ).scalar_one()
        assert recording.status == "received"
        assert job.recording_id == "rec-mock-client-create"
    finally:
        session.close()


def test_post_process_accepts_capture_context_timeline(
    client: TestClient,
    fixtures_dir: Path,
) -> None:
    timeline_bytes = (fixtures_dir / "timeline.capture-context.json").read_bytes()
    response = client.post(
        "/process",
        files={
            "mic": ("mic.webm", b"mock-mic-webm-content", "audio/webm"),
            "timeline": ("timeline.json", timeline_bytes, "application/json"),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["recordingId"] == "rec-capture-context-demo"


def test_post_process_rejects_invalid_timeline(client: TestClient) -> None:
    invalid_timeline = json.dumps({"meta": {"recordingId": "broken"}}).encode("utf-8")
    response = client.post(
        "/process",
        files={
            "mic": ("mic.webm", b"mic", "audio/webm"),
            "timeline": ("timeline.json", invalid_timeline, "application/json"),
        },
    )
    assert response.status_code == 422


def test_delete_recording_removes_files_and_db_rows(
    client: TestClient,
    fixtures_dir: Path,
) -> None:
    timeline_bytes = (fixtures_dir / "timeline.mock.json").read_bytes()
    create_response = client.post(
        "/process",
        files={
            "mic": ("mic.webm", b"mic", "audio/webm"),
            "timeline": ("timeline.json", timeline_bytes, "application/json"),
        },
    )
    recording_id = create_response.json()["recordingId"]

    delete_response = client.delete(f"/recording/{recording_id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True

    storage_root = get_storage_root()
    assert not (storage_root / recording_id).exists()

    session = get_session_factory()()
    try:
        recording = session.execute(
            select(Recording).where(Recording.recording_id == recording_id),
        ).scalar_one_or_none()
        jobs = session.execute(
            select(Job).where(Job.recording_id == recording_id),
        ).all()
        assert recording is None
        assert jobs == []
    finally:
        session.close()

    missing_response = client.delete(f"/recording/{recording_id}")
    assert missing_response.status_code == 404
