"""Регрессионные тесты на правки из ревью: path traversal (#2) и офсет часов (#3)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from fastapi.testclient import TestClient

from backend.services.merge import apply_transcript_offset, merge_timeline


def _load_timeline(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "timeline.mock.json").read_text(encoding="utf-8")),
    )


def test_apply_transcript_offset_shifts_and_is_pure() -> None:
    transcript = [
        {
            "start": 0,
            "end": 100,
            "text": "привет",
            "words": [{"word": "привет", "start": 0, "end": 100}],
        },
    ]
    shifted = apply_transcript_offset(transcript, 250)

    assert shifted[0]["start"] == 250
    assert shifted[0]["end"] == 350
    assert shifted[0]["words"][0]["start"] == 250
    assert shifted[0]["words"][0]["end"] == 350
    # исходный список не мутируется
    assert transcript[0]["start"] == 0
    # нулевой офсет — no-op (тот же объект)
    assert apply_transcript_offset(transcript, 0) is transcript


def test_merge_applies_mic_offset_to_speech(fixtures_dir: Path) -> None:
    timeline = _load_timeline(fixtures_dir)
    base_meta = {**timeline["meta"], "micStartOffsetMs": 0}
    shifted_meta = {**timeline["meta"], "micStartOffsetMs": 1000}

    base = merge_timeline({**timeline, "meta": base_meta})
    shifted = merge_timeline({**timeline, "meta": shifted_meta})

    assert base["steps"] and shifted["steps"]
    assert shifted["steps"][0]["speechStart"] == base["steps"][0]["speechStart"] + 1000


def test_process_rejects_path_traversal_recording_id(
    client: TestClient,
    fixtures_dir: Path,
) -> None:
    timeline = _load_timeline(fixtures_dir)
    timeline["meta"]["recordingId"] = "../../evil"

    response = client.post(
        "/process",
        files={
            "mic": ("mic.webm", b"fake-audio", "audio/webm"),
            "timeline": (
                "timeline.json",
                json.dumps(timeline).encode("utf-8"),
                "application/json",
            ),
        },
    )

    assert response.status_code == 422


def test_delete_rejects_path_traversal_recording_id(client: TestClient) -> None:
    response = client.delete("/recording/..%2F..%2Fevil")
    # либо схема/валидатор (400), либо роутинг не нашёл такой записи (404),
    # но точно НЕ 200 и не попытка удалить вне storage.
    assert response.status_code in (400, 404)
