from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any, cast

from fastapi.testclient import TestClient

from backend.services.render import (
    build_markdown_zip,
    export_step_image_path,
    render_html,
    render_markdown,
)


def _load_mock_generated_doc(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "generated_doc.mock.json").read_text(encoding="utf-8")),
    )


def _seed_recording(client: TestClient, fixtures_dir: Path) -> str:
    timeline_bytes = (fixtures_dir / "timeline.mock.json").read_bytes()
    screenshot_bytes = b"\xff\xd8\xffmockjpeg"
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

    from backend.config import get_storage_root
    from backend.storage import save_generated_doc

    doc = _load_mock_generated_doc(fixtures_dir)
    save_generated_doc(get_storage_root(), recording_id, doc)

    screenshots_dir = get_storage_root() / recording_id / "screenshots"
    for screenshot_id in ("scr-001", "scr-002", "scr-003"):
        (screenshots_dir / f"{screenshot_id}.jpg").write_bytes(screenshot_bytes)

    return recording_id


def test_render_markdown_uses_per_step_image_paths(fixtures_dir: Path) -> None:
    doc = _load_mock_generated_doc(fixtures_dir)
    step_id = doc["steps"][0]["id"]
    custom_path = export_step_image_path(step_id)
    markdown = render_markdown(doc, step_image_paths={step_id: custom_path})

    assert custom_path in markdown
    assert "(screenshots/scr-002.jpg)" in markdown


def test_build_markdown_zip_contains_instruction_and_images(fixtures_dir: Path) -> None:
    doc = _load_mock_generated_doc(fixtures_dir)
    step_id = doc["steps"][0]["id"]
    png_bytes = b"\x89PNG\r\n\x1a\nmock"
    archive_bytes = build_markdown_zip(
        doc,
        {step_id: png_bytes},
        step_image_paths={step_id: export_step_image_path(step_id)},
    )

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as zf:
        names = set(zf.namelist())
        assert "instruction.md" in names
        assert export_step_image_path(step_id) in names
        assert png_bytes in zf.read(export_step_image_path(step_id))


def test_render_html_inline_images(fixtures_dir: Path) -> None:
    doc = _load_mock_generated_doc(fixtures_dir)
    step_id = doc["steps"][0]["id"]
    data_url = "data:image/png;base64,aGVsbG8="
    html = render_html(doc, inline_image_data={step_id: data_url})

    assert data_url in html
    assert 'src="screenshots/scr-002.jpg"' in html


def test_post_export_markdown_zip(client: TestClient, fixtures_dir: Path) -> None:
    recording_id = _seed_recording(client, fixtures_dir)
    doc = _load_mock_generated_doc(fixtures_dir)
    doc["steps"][0]["title"] = "Экспорт с правкой"
    step_id = doc["steps"][0]["id"]
    annotated_png = b"\x89PNG\r\n\x1a\nannotated"

    response = client.post(
        f"/recording/{recording_id}/export",
        data={"doc": json.dumps(doc), "format": "md"},
        files={
            f"step_image_{step_id}": (
                f"step_image_{step_id}.png",
                annotated_png,
                "image/png",
            ),
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")

    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        markdown = zf.read("instruction.md").decode("utf-8")
        assert "Экспорт с правкой" in markdown
        assert export_step_image_path(step_id) in zf.namelist()
        assert zf.read(export_step_image_path(step_id)) == annotated_png


def test_post_export_html_with_inline_annotated_images(
    client: TestClient,
    fixtures_dir: Path,
) -> None:
    recording_id = _seed_recording(client, fixtures_dir)
    doc = _load_mock_generated_doc(fixtures_dir)
    step_id = doc["steps"][0]["id"]
    annotated_png = b"\x89PNG\r\n\x1a\nannotated"

    response = client.post(
        f"/recording/{recording_id}/export",
        data={"doc": json.dumps(doc), "format": "html"},
        files={
            f"step_image_{step_id}": (
                f"step_image_{step_id}.png",
                annotated_png,
                "image/png",
            ),
        },
    )
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "data:image/png;base64," in response.text
    assert doc["title"] in response.text


def test_post_export_unknown_recording_returns_404(client: TestClient) -> None:
    response = client.post(
        "/recording/missing-id/export",
        data={"doc": "{}", "format": "html"},
    )
    assert response.status_code == 404
