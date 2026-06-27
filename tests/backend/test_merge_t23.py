from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from backend.services.merge import (
    build_sorted_entries,
    build_speech_anchors,
    merge_timeline,
)


def _load_mock_timeline(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "timeline.mock.json").read_text(encoding="utf-8")),
    )


def test_sorted_entries_are_monotonic_by_ts(fixtures_dir: Path) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    merged = merge_timeline(timeline)
    entries = merged["entries"]

    assert len(entries) == len(timeline["transcript"]) + len(timeline["events"]) + len(
        timeline["screenshots"],
    )

    previous_ts = -1
    for entry in entries:
        assert entry["ts"] >= previous_ts
        previous_ts = entry["ts"]
        assert entry["kind"] in {"speech", "event", "screenshot"}


def test_speech_anchors_split_mock_replicas(fixtures_dir: Path) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    anchors = build_speech_anchors(timeline["transcript"])

    assert len(anchors) == 3
    assert anchors[0]["text"].startswith("Сейчас нажмём")
    assert anchors[1]["text"].startswith("Вводим название")
    assert anchors[2]["text"].startswith("Сохраняем")


def test_preliminary_steps_group_events_around_speech(fixtures_dir: Path) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    merged = merge_timeline(timeline)
    steps = merged["steps"]

    assert len(steps) == 3

    assert steps[0]["eventIds"] == ["evt-001", "evt-002", "evt-003"]
    assert steps[1]["eventIds"] == ["evt-004"]
    assert steps[2]["eventIds"] == ["evt-005", "evt-006"]

    assert steps[0]["speechText"].startswith("Сейчас нажмём")
    assert steps[1]["speechText"].startswith("Вводим название")
    assert steps[2]["speechText"].startswith("Сохраняем")


def test_each_preliminary_step_has_screenshot(fixtures_dir: Path) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    merged = merge_timeline(timeline)
    steps = merged["steps"]

    assert steps[0]["screenshotId"] == "scr-001"
    assert steps[0]["screenshotConfidence"] == "high"
    assert steps[0]["screenshotCandidates"] == ["scr-001a", "scr-001b"]

    assert steps[1]["screenshotId"] == "scr-002"
    assert steps[1]["screenshotConfidence"] == "high"

    assert steps[2]["screenshotId"] == "scr-003"
    assert steps[2]["screenshotConfidence"] == "high"


def test_build_sorted_entries_includes_all_kinds() -> None:
    transcript = [{"start": 100, "end": 500, "text": "hello"}]
    events = [{"id": "evt-1", "ts": 200, "type": "click", "url": "https://x", "target": None}]
    screenshots = [
        {
            "id": "scr-1",
            "ts": 300,
            "eventId": "evt-1",
            "confidence": "high",
            "width": 100,
            "height": 100,
        },
    ]

    entries = build_sorted_entries(
        transcript=transcript,
        events=events,
        screenshots=screenshots,
    )

    kinds = {entry["kind"] for entry in entries}
    assert kinds == {"speech", "event", "screenshot"}
