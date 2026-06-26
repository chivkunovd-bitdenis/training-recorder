"""Сквозной smoke MVP без живого OpenAI (редактор → экспорт → удаление)."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any, cast

from fastapi.testclient import TestClient

from backend.config import get_storage_root


def _load_mock_generated_doc(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "generated_doc.mock.json").read_text(encoding="utf-8")),
    )


def test_mvp_smoke_happy_path(client: TestClient, fixtures_dir: Path) -> None:
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    timeline_bytes = (fixtures_dir / "timeline.mock.json").read_bytes()
    screenshot_bytes = b"\xff\xd8\xffmockjpeg"
    create = client.post(
        "/process",
        files={
            "mic": ("mic.webm", b"mic-audio", "audio/webm"),
            "timeline": ("timeline.json", timeline_bytes, "application/json"),
            "screenshots": ("scr-001.jpg", screenshot_bytes, "image/jpeg"),
        },
    )
    assert create.status_code == 200
    recording_id = str(create.json()["recordingId"])

    screenshots_dir = get_storage_root() / recording_id / "screenshots"
    for screenshot_id in ("scr-001", "scr-002", "scr-003"):
        (screenshots_dir / f"{screenshot_id}.jpg").write_bytes(screenshot_bytes)

    doc = _load_mock_generated_doc(fixtures_dir)
    doc["steps"][0]["title"] = "Smoke: отредактированный заголовок"
    save = client.put(f"/recording/{recording_id}/doc", json=doc)
    assert save.status_code == 200

    loaded = client.get(f"/recording/{recording_id}/doc", params={"format": "json"})
    assert loaded.status_code == 200
    assert loaded.json()["steps"][0]["title"] == "Smoke: отредактированный заголовок"

    markdown = client.get(f"/recording/{recording_id}/doc", params={"format": "md"})
    assert markdown.status_code == 200
    assert "Smoke: отредактированный заголовок" in markdown.text

    html = client.get(f"/recording/{recording_id}/doc", params={"format": "html"})
    assert html.status_code == 200
    assert "<!DOCTYPE html>" in html.text

    editor = client.get(f"/editor/recording/{recording_id}")
    assert editor.status_code == 200
    assert "text/html" in editor.headers["content-type"]

    timeline = client.get(f"/recording/{recording_id}/timeline")
    assert timeline.status_code == 200
    assert timeline.json()["events"]

    step_id = doc["steps"][0]["id"]
    export_md = client.post(
        f"/recording/{recording_id}/export",
        data={"doc": json.dumps(doc), "format": "md"},
        files={
            f"step_image_{step_id}": (
                f"step_image_{step_id}.png",
                b"\x89PNG\r\n\x1a\nsmoke",
                "image/png",
            ),
        },
    )
    assert export_md.status_code == 200
    assert export_md.headers["content-type"].startswith("application/zip")
    with zipfile.ZipFile(io.BytesIO(export_md.content)) as archive:
        md_text = archive.read("instruction.md").decode("utf-8")
        assert "Smoke: отредактированный заголовок" in md_text

    export_html = client.post(
        f"/recording/{recording_id}/export",
        data={"doc": json.dumps(doc), "format": "html"},
    )
    assert export_html.status_code == 200
    assert "<!DOCTYPE html>" in export_html.text

    deleted = client.delete(f"/recording/{recording_id}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True

    missing = client.get(f"/recording/{recording_id}/doc", params={"format": "json"})
    assert missing.status_code == 404
