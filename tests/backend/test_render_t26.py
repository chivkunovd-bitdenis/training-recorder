from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from fastapi.testclient import TestClient

from backend.config import get_storage_root
from backend.services.render import (
    SECTION_AUDIENCE,
    SECTION_PREREQUISITES,
    SECTION_PURPOSE,
    SECTION_RESULT,
    SECTION_STEPS,
    SECTION_WARNINGS,
    render_html,
    render_markdown,
)
from backend.storage import save_generated_doc


def _load_mock_generated_doc(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "generated_doc.mock.json").read_text(encoding="utf-8")),
    )


def test_render_markdown_contains_sections_and_screenshots(fixtures_dir: Path) -> None:
    doc = _load_mock_generated_doc(fixtures_dir)
    markdown = render_markdown(doc)

    assert markdown.startswith(f"# {doc['title']}")
    assert f"## {SECTION_PURPOSE}" in markdown
    assert f"## {SECTION_AUDIENCE}" in markdown
    assert f"## {SECTION_PREREQUISITES}" in markdown
    assert f"## {SECTION_STEPS}" in markdown
    assert f"## {SECTION_WARNINGS}" in markdown
    assert f"## {SECTION_RESULT}" in markdown
    assert "(screenshots/scr-001.jpg)" in markdown
    assert "(screenshots/scr-002.jpg)" in markdown
    assert "(screenshots/scr-003.jpg)" in markdown
    assert "### 1. Откройте форму создания клиента" in markdown


def test_render_html_is_self_contained_with_images(fixtures_dir: Path) -> None:
    doc = _load_mock_generated_doc(fixtures_dir)
    html = render_html(doc)

    assert html.startswith("<!DOCTYPE html>")
    assert "<html lang=\"ru\">" in html
    assert f"<h2>{SECTION_STEPS}</h2>" in html
    assert 'src="screenshots/scr-001.jpg"' in html
    assert 'src="screenshots/scr-003.jpg"' in html
    assert "@media print" in html
    assert doc["title"] in html


def _seed_recording_with_doc(
    client: TestClient,
    fixtures_dir: Path,
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

    doc = _load_mock_generated_doc(fixtures_dir)
    save_generated_doc(get_storage_root(), recording_id, doc)

    screenshots_dir = get_storage_root() / recording_id / "screenshots"
    for screenshot_id in ("scr-001", "scr-002", "scr-003"):
        (screenshots_dir / f"{screenshot_id}.jpg").write_bytes(screenshot_bytes)

    return recording_id


def test_get_recording_doc_markdown(client: TestClient, fixtures_dir: Path) -> None:
    recording_id = _seed_recording_with_doc(client, fixtures_dir)

    response = client.get(f"/recording/{recording_id}/doc", params={"format": "md"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert f"# {_load_mock_generated_doc(fixtures_dir)['title']}" in response.text
    assert "(screenshots/scr-001.jpg)" in response.text


def test_get_recording_doc_html(client: TestClient, fixtures_dir: Path) -> None:
    recording_id = _seed_recording_with_doc(client, fixtures_dir)

    response = client.get(f"/recording/{recording_id}/doc", params={"format": "html"})
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "<!DOCTYPE html>" in response.text
    assert 'src="screenshots/scr-002.jpg"' in response.text


def test_get_recording_doc_without_generated_doc_returns_404(
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

    response = client.get(f"/recording/{recording_id}/doc", params={"format": "html"})
    assert response.status_code == 404
    assert "не сгенерирован" in response.json()["detail"]
