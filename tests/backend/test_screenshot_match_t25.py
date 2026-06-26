from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from backend.services.screenshot_match import (
    match_step_screenshot,
    refine_generated_doc_from_timeline,
)


def _load_mock_timeline(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "timeline.mock.json").read_text(encoding="utf-8")),
    )


def _load_mock_generated_doc(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "generated_doc.mock.json").read_text(encoding="utf-8")),
    )


def _events_by_id(timeline: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(event["id"]): event for event in timeline["events"]}


def test_linked_step_prefers_high_confidence_screenshot(fixtures_dir: Path) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    screenshots = timeline["screenshots"]
    events_by_id = _events_by_id(timeline)

    step = {
        "id": "step-001",
        "eventIds": ["evt-001", "evt-002"],
        "needsReview": False,
    }
    screenshot_id, needs_review, candidates = match_step_screenshot(
        step,
        screenshots,
        events_by_id=events_by_id,
    )

    assert screenshot_id == "scr-001"
    assert needs_review is False
    assert "scr-001a" in candidates
    assert "scr-001b" in candidates


def test_step_without_linked_screenshot_uses_nearest_and_needs_review(
    fixtures_dir: Path,
) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    screenshots = timeline["screenshots"]
    events_by_id = _events_by_id(timeline)

    step = {
        "id": "step-003",
        "eventIds": ["evt-004"],
        "needsReview": False,
    }
    screenshot_id, needs_review, candidates = match_step_screenshot(
        step,
        screenshots,
        events_by_id=events_by_id,
    )

    assert screenshot_id == "scr-002"
    assert needs_review is True
    assert candidates


def test_refine_mock_doc_gives_screenshot_or_needs_review_for_each_step(
    fixtures_dir: Path,
) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    doc = _load_mock_generated_doc(fixtures_dir)

    refined = refine_generated_doc_from_timeline(doc, timeline)

    assert len(refined["steps"]) == 4
    for step in refined["steps"]:
        assert step["screenshotId"] is not None or step["needsReview"] is True
        assert isinstance(step["screenshotCandidates"], list)

    step_by_id = {step["id"]: step for step in refined["steps"]}

    assert step_by_id["step-001"]["screenshotId"] == "scr-001"
    assert "scr-001a" in step_by_id["step-001"]["screenshotCandidates"]

    assert step_by_id["step-002"]["screenshotId"] == "scr-002"
    assert "scr-002a" in step_by_id["step-002"]["screenshotCandidates"]

    assert step_by_id["step-003"]["screenshotId"] == "scr-002"
    assert step_by_id["step-003"]["needsReview"] is True

    assert step_by_id["step-004"]["screenshotId"] == "scr-003"
    assert step_by_id["step-004"]["screenshotCandidates"]


def test_refine_preserves_llm_needs_review_flag(fixtures_dir: Path) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    doc = _load_mock_generated_doc(fixtures_dir)
    doc["steps"][0]["needsReview"] = True

    refined = refine_generated_doc_from_timeline(doc, timeline)

    assert refined["steps"][0]["needsReview"] is True


def test_empty_screenshots_marks_steps_for_review() -> None:
    doc = {
        "title": "t",
        "purpose": "p",
        "audience": "a",
        "prerequisites": "pr",
        "warnings": [],
        "result": "r",
        "steps": [
            {
                "id": "step-001",
                "title": "x",
                "body": "y",
                "screenshotId": "scr-001",
                "eventIds": ["evt-001"],
                "needsReview": False,
            },
        ],
    }

    from backend.services.screenshot_match import refine_generated_doc_screenshots

    refined = refine_generated_doc_screenshots(doc, screenshots=[], events=[])

    assert refined["steps"][0]["screenshotId"] is None
    assert refined["steps"][0]["needsReview"] is True
    assert refined["steps"][0]["screenshotCandidates"] == []
