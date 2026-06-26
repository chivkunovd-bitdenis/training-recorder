from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, TypedDict, cast

from openai import APIError, OpenAI

from backend.config import (
    get_openai_api_key,
    get_vision_budget_per_recording,
    get_vision_model,
    get_vision_prompt_path,
)
from backend.services.merge import MergedTimeline, PreliminaryStep

logger = logging.getLogger(__name__)


class VisionError(RuntimeError):
    pass


class VisionCandidate(TypedDict):
    kind: Literal["event", "screenshot"]
    step_id: str
    event_id: str | None
    screenshot_id: str
    reason: str


@dataclass(frozen=True)
class VisionStats:
    calls_made: int
    budget: int
    candidates_total: int
    skipped_no_image: int


def load_vision_prompt() -> str:
    return get_vision_prompt_path().read_text(encoding="utf-8")


def element_context_is_sparse(target: dict[str, Any] | None) -> bool:
    """Нет text, role и label — DOM не даёт понятного описания."""
    if target is None:
        return True
    text = str(target.get("text") or "").strip()
    role = str(target.get("role") or "").strip()
    label = str(target.get("label") or "").strip()
    return not text and not role and not label


def _screenshots_by_event_id(screenshots: list[dict[str, Any]]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for screenshot in screenshots:
        event_id = screenshot.get("eventId")
        if event_id:
            mapping[str(event_id)] = str(screenshot["id"])
    return mapping


def _resolve_screenshot_for_event(
    event: dict[str, Any],
    step: PreliminaryStep,
    screenshots_by_event: dict[str, str],
) -> str | None:
    event_id = str(event["id"])
    if event_id in screenshots_by_event:
        return screenshots_by_event[event_id]
    return step.get("screenshotId")


def collect_vision_candidates(merged: MergedTimeline) -> list[VisionCandidate]:
    screenshots = [
        entry["data"] for entry in merged["entries"] if entry["kind"] == "screenshot"
    ]
    screenshots_by_event = _screenshots_by_event_id(screenshots)
    candidates: list[VisionCandidate] = []
    seen_events: set[str] = set()
    seen_low_conf_screenshots: set[str] = set()

    for step in merged["steps"]:
        for event in step["events"]:
            if not element_context_is_sparse(cast(dict[str, Any] | None, event.get("target"))):
                continue
            event_id = str(event["id"])
            if event_id in seen_events:
                continue
            screenshot_id = _resolve_screenshot_for_event(event, step, screenshots_by_event)
            if not screenshot_id:
                continue
            seen_events.add(event_id)
            candidates.append(
                VisionCandidate(
                    kind="event",
                    step_id=step["id"],
                    event_id=event_id,
                    screenshot_id=screenshot_id,
                    reason="sparse_element_context",
                ),
            )

        screenshot_id = step.get("screenshotId")
        confidence = step.get("screenshotConfidence")
        if (
            screenshot_id
            and confidence == "low"
            and screenshot_id not in seen_low_conf_screenshots
        ):
            seen_low_conf_screenshots.add(screenshot_id)
            candidates.append(
                VisionCandidate(
                    kind="screenshot",
                    step_id=step["id"],
                    event_id=None,
                    screenshot_id=screenshot_id,
                    reason="low_confidence_screenshot",
                ),
            )

    return candidates


def load_screenshot_bytes(
    storage_root: Path,
    recording_id: str,
    screenshot_id: str,
) -> bytes | None:
    path = storage_root / recording_id / "screenshots" / f"{screenshot_id}.jpg"
    if not path.is_file():
        return None
    return path.read_bytes()


def _build_vision_user_text(candidate: VisionCandidate, event: dict[str, Any] | None) -> str:
    lines = [
        f"Причина: {candidate['reason']}",
        f"Тип кандидата: {candidate['kind']}",
    ]
    if event is not None:
        lines.append(f"Тип события: {event.get('type')}")
        target = event.get("target")
        if isinstance(target, dict):
            bbox = target.get("bbox")
            if isinstance(bbox, dict):
                lines.append(
                    "Область элемента (bbox): "
                    f"x={bbox.get('x')}, y={bbox.get('y')}, "
                    f"w={bbox.get('w')}, h={bbox.get('h')}",
                )
            tag = target.get("tag")
            if tag:
                lines.append(f"HTML-тег: {tag}")
    return "\n".join(lines)


def describe_with_vision(
    image_bytes: bytes,
    user_text: str,
    *,
    client: OpenAI | None = None,
) -> str:
    api_key = get_openai_api_key()
    openai_client = client or OpenAI(api_key=api_key)
    model = get_vision_model()
    system_prompt = load_vision_prompt()
    encoded = base64.b64encode(image_bytes).decode("ascii")
    mime = "image/png" if image_bytes[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"

    try:
        response = openai_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{encoded}"},
                        },
                    ],
                },
            ],
            max_tokens=220,
        )
    except APIError as exc:
        raise VisionError(str(exc)) from exc
    content = response.choices[0].message.content
    if not content or not content.strip():
        raise VisionError("Vision-модель вернула пустой ответ")
    return content.strip()


def _events_by_id(step: PreliminaryStep) -> dict[str, dict[str, Any]]:
    return {str(event["id"]): event for event in step["events"]}


def enrich_merged_with_vision(
    merged: MergedTimeline,
    recording_id: str,
    storage_root: Path,
    *,
    client: OpenAI | None = None,
    budget: int | None = None,
) -> tuple[MergedTimeline, VisionStats]:
    """Дополнить предварительные шаги vision-описаниями (fallback, с лимитом вызовов)."""
    limit = budget if budget is not None else get_vision_budget_per_recording()
    candidates = collect_vision_candidates(merged)
    calls_made = 0
    skipped_no_image = 0

    steps_by_id = {step["id"]: step for step in merged["steps"]}

    for candidate in candidates:
        if calls_made >= limit:
            break

        image_bytes = load_screenshot_bytes(
            storage_root,
            recording_id,
            candidate["screenshot_id"],
        )
        if image_bytes is None:
            skipped_no_image += 1
            continue

        step = steps_by_id[candidate["step_id"]]
        event = None
        if candidate["event_id"] is not None:
            event = _events_by_id(step).get(candidate["event_id"])

        user_text = _build_vision_user_text(candidate, event)
        try:
            description = describe_with_vision(image_bytes, user_text, client=client)
        except VisionError as exc:
            logger.warning(
                "Vision call failed for %s: %s",
                candidate["screenshot_id"],
                exc,
            )
            if "insufficient_quota" in str(exc).lower() or "429" in str(exc):
                break
            continue
        calls_made += 1

        if candidate["kind"] == "event" and candidate["event_id"]:
            existing = step.get("visionEventDescriptions")
            if not isinstance(existing, dict):
                existing = {}
                step["visionEventDescriptions"] = existing
            existing[candidate["event_id"]] = description
        elif candidate["kind"] == "screenshot":
            step["visionScreenshotDescription"] = description

        logger.info(
            "Vision fallback: recording=%s kind=%s screenshot=%s",
            recording_id,
            candidate["kind"],
            candidate["screenshot_id"],
        )

    meta = merged["meta"]
    meta["visionCallsUsed"] = calls_made
    meta["visionBudget"] = limit

    stats = VisionStats(
        calls_made=calls_made,
        budget=limit,
        candidates_total=len(candidates),
        skipped_no_image=skipped_no_image,
    )
    return merged, stats
