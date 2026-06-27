from __future__ import annotations

from typing import Any, cast

from backend.services.merge import (
    SpeechAnchor,
    build_preliminary_steps,
    merge_timeline,
)


def _click_anchor_timeline() -> dict[str, Any]:
    return {
        "meta": {
            "recordingId": "rec-click-modal",
            "t0": 1719403200000,
            "url": "https://app.example.com/warehouse",
            "title": "Warehouse",
            "durationMs": 5000,
            "userAgent": "test",
            "micStartOffsetMs": 0,
        },
        "events": [
            {
                "id": "evt-click-close",
                "type": "click",
                "ts": 1500,
                "url": "https://app.example.com/warehouse",
                "target": {
                    "text": "Закрыть короб",
                    "bbox": {"x": 520, "y": 180, "w": 140, "h": 36},
                },
            },
            {
                "id": "evt-modal",
                "type": "modal_open",
                "ts": 1700,
                "url": "https://app.example.com/warehouse",
                "target": {
                    "text": "Подтверждение",
                    "bbox": {"x": 400, "y": 200, "w": 480, "h": 320},
                },
            },
        ],
        "screenshots": [
            {
                "id": "scr-click",
                "ts": 1600,
                "eventId": "evt-click-close",
                "confidence": "high",
                "width": 2560,
                "height": 1440,
            },
            {
                "id": "scr-modal",
                "ts": 1800,
                "eventId": "evt-modal",
                "confidence": "high",
                "width": 2560,
                "height": 1440,
            },
        ],
        "transcript": [
            {
                "start": 1000,
                "end": 2500,
                "text": "Нажимаем закрыть короб и подтверждаем.",
            },
        ],
    }


def test_preliminary_step_anchors_on_click_not_modal() -> None:
    timeline = _click_anchor_timeline()
    merged = merge_timeline(timeline)
    steps = merged["steps"]

    assert len(steps) == 1
    step = steps[0]

    assert step["eventIds"][0] == "evt-click-close"
    assert "evt-modal" in step["eventIds"]
    assert step["screenshotId"] == "scr-click"
    assert step["screenshotConfidence"] == "high"


def test_build_preliminary_steps_prefers_pointer_screenshot() -> None:
    timeline = _click_anchor_timeline()
    anchors = cast(
        list[SpeechAnchor],
        [{"start": 1000, "end": 2500, "text": "speech", "segmentIndexes": [0]}],
    )
    steps = build_preliminary_steps(
        anchors=anchors,
        events=timeline["events"],
        screenshots=timeline["screenshots"],
    )

    assert steps[0]["screenshotId"] == "scr-click"
    assert steps[0]["eventIds"][0] == "evt-click-close"
