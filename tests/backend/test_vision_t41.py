from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast
from unittest.mock import MagicMock

import pytest

from backend.services.generate import build_generation_context
from backend.services.merge import merge_timeline
from backend.services.vision import (
    collect_vision_candidates,
    describe_with_vision,
    element_context_is_sparse,
    enrich_merged_with_vision,
    load_screenshot_bytes,
)


def _load_mock_timeline(fixtures_dir: Path) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads((fixtures_dir / "timeline.mock.json").read_text(encoding="utf-8")),
    )


def _timeline_with_icon_click(fixtures_dir: Path) -> dict[str, Any]:
    timeline = _load_mock_timeline(fixtures_dir)
    timeline["events"].append(
        {
            "id": "evt-icon",
            "type": "click",
            "ts": 3000,
            "url": "https://app.example.com/clients",
            "target": {
                "role": None,
                "text": None,
                "placeholder": None,
                "label": None,
                "nearbyText": "Панель действий",
                "tag": "svg",
                "cssPath": "button.icon-only > svg",
                "bbox": {"x": 40, "y": 40, "w": 24, "h": 24},
                "masked": False,
            },
        },
    )
    timeline["screenshots"].append(
        {
            "id": "scr-icon",
            "ts": 3200,
            "eventId": "evt-icon",
            "confidence": "high",
            "width": 1440,
            "height": 900,
        },
    )
    return timeline


def _timeline_without_vision_triggers(fixtures_dir: Path) -> dict[str, Any]:
    timeline = _load_mock_timeline(fixtures_dir)
    timeline["events"] = [
        event
        for event in timeline["events"]
        if event.get("target") is not None
    ]
    for screenshot in timeline["screenshots"]:
        screenshot["confidence"] = "high"
    return timeline


def test_element_context_is_sparse_for_icon_without_labels() -> None:
    target = {
        "role": None,
        "text": None,
        "label": None,
        "tag": "svg",
    }
    assert element_context_is_sparse(target) is True


def test_element_context_is_sparse_false_for_button_with_text() -> None:
    target = {
        "role": "button",
        "text": "Создать клиента",
        "label": None,
    }
    assert element_context_is_sparse(target) is False


def test_collect_vision_candidates_includes_icon_and_low_confidence(
    fixtures_dir: Path,
) -> None:
    merged = merge_timeline(_timeline_with_icon_click(fixtures_dir))
    candidates = collect_vision_candidates(merged)

    kinds = {(item["kind"], item.get("event_id"), item["screenshot_id"]) for item in candidates}
    assert ("event", "evt-icon", "scr-icon") in kinds

    merged["steps"][-1]["screenshotId"] = "scr-004"
    merged["steps"][-1]["screenshotConfidence"] = "low"
    low_conf_candidates = collect_vision_candidates(merged)
    assert any(
        item["reason"] == "low_confidence_screenshot" and item["screenshot_id"] == "scr-004"
        for item in low_conf_candidates
    )


def test_collect_vision_candidates_empty_for_rich_dom(fixtures_dir: Path) -> None:
    merged = merge_timeline(_timeline_without_vision_triggers(fixtures_dir))
    assert collect_vision_candidates(merged) == []


def test_describe_with_vision_mock_client() -> None:
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "Иконка шестерёнки в шапке — настройки."

    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_response

    description = describe_with_vision(
        b"\xff\xd8\xffmockjpeg",
        "Причина: sparse_element_context",
        client=mock_client,
    )

    assert "шестерёнки" in description
    call_kwargs = mock_client.chat.completions.create.call_args.kwargs
    user_content = call_kwargs["messages"][1]["content"]
    assert any(part["type"] == "image_url" for part in user_content)


def test_enrich_merged_with_vision_applies_descriptions_and_respects_budget(
    fixtures_dir: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording_id = "rec-vision-test"
    screenshot_bytes = b"\xff\xd8\xffmockjpeg"
    screenshots_dir = tmp_path / recording_id / "screenshots"
    screenshots_dir.mkdir(parents=True)
    for screenshot_id in ("scr-icon", "scr-004"):
        (screenshots_dir / f"{screenshot_id}.jpg").write_bytes(screenshot_bytes)

    merged = merge_timeline(_timeline_with_icon_click(fixtures_dir))
    merged["steps"][-1]["screenshotId"] = "scr-004"
    merged["steps"][-1]["screenshotConfidence"] = "low"

    descriptions = iter(
        [
            "Иконка фильтра в панели инструментов.",
            "Экран загружается, виден список клиентов.",
            "Лишний вызов не должен случиться.",
        ],
    )

    def fake_describe(
        image_bytes: bytes,
        user_text: str,
        *,
        client: object | None = None,
    ) -> str:
        _ = image_bytes, user_text, client
        return next(descriptions)

    monkeypatch.setattr("backend.services.vision.describe_with_vision", fake_describe)

    enriched, stats = enrich_merged_with_vision(
        merged,
        recording_id,
        tmp_path,
        budget=5,
    )

    assert stats.calls_made >= 2
    assert stats.calls_made <= stats.budget
    assert stats.candidates_total >= 2

    step_with_icon = next(
        step for step in enriched["steps"] if "evt-icon" in step.get("eventIds", [])
    )
    assert step_with_icon["visionEventDescriptions"]["evt-icon"].startswith("Иконка")

    low_conf_step = next(
        step for step in enriched["steps"] if step.get("screenshotId") == "scr-004"
    )
    assert low_conf_step.get("visionScreenshotDescription")

    context = build_generation_context(enriched)
    enriched_step = next(
        item for item in context["preliminarySteps"] if item["id"] == step_with_icon["id"]
    )
    assert enriched_step["visionEventDescriptions"]["evt-icon"]


def test_enrich_respects_vision_budget(
    fixtures_dir: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recording_id = "rec-vision-budget"
    screenshot_bytes = b"\xff\xd8\xffmockjpeg"
    screenshots_dir = tmp_path / recording_id / "screenshots"
    screenshots_dir.mkdir(parents=True)
    (screenshots_dir / "scr-icon.jpg").write_bytes(screenshot_bytes)

    merged = merge_timeline(_timeline_with_icon_click(fixtures_dir))
    calls = {"count": 0}

    def fake_describe(*args: object, **kwargs: object) -> str:
        calls["count"] += 1
        return "описание"

    monkeypatch.setattr("backend.services.vision.describe_with_vision", fake_describe)

    _, stats = enrich_merged_with_vision(merged, recording_id, tmp_path, budget=1)
    assert stats.calls_made == 1
    assert calls["count"] == 1


def test_enrich_skips_when_screenshot_missing(
    fixtures_dir: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    merged = merge_timeline(_timeline_with_icon_click(fixtures_dir))

    call_counter = {"count": 0}

    def fake_describe(*args: object, **kwargs: object) -> str:
        call_counter["count"] += 1
        return "desc"

    monkeypatch.setattr("backend.services.vision.describe_with_vision", fake_describe)

    _, stats = enrich_merged_with_vision(merged, "missing-recording", tmp_path, budget=5)
    assert stats.calls_made == 0
    assert stats.skipped_no_image > 0


def test_load_screenshot_bytes_from_storage(tmp_path: Path) -> None:
    recording_id = "rec-1"
    screenshots_dir = tmp_path / recording_id / "screenshots"
    screenshots_dir.mkdir(parents=True)
    payload = b"\xff\xd8\xffdata"
    (screenshots_dir / "scr-001.jpg").write_bytes(payload)

    loaded = load_screenshot_bytes(tmp_path, recording_id, "scr-001")
    assert loaded == payload


def test_normal_mock_timeline_does_not_flag_rich_button_events(fixtures_dir: Path) -> None:
    merged = merge_timeline(_load_mock_timeline(fixtures_dir))
    event_candidates = [
        item for item in collect_vision_candidates(merged) if item["kind"] == "event"
    ]
    assert all(item["event_id"] != "evt-001" for item in event_candidates)
