from __future__ import annotations

import copy
import logging
from typing import Any, TypedDict, cast

from backend.services.generate import GeneratedDoc

logger = logging.getLogger(__name__)

POINTER_EVENT_TYPES = frozenset({"click", "submit", "menu_select"})


class RefinedStep(TypedDict):
    id: str
    title: str
    body: str
    screenshotId: str | None
    eventIds: list[str]
    needsReview: bool
    screenshotCandidates: list[str]


class RefinedGeneratedDoc(TypedDict):
    title: str
    purpose: str
    audience: str
    prerequisites: str
    steps: list[RefinedStep]
    warnings: list[str]
    result: str


def _confidence_rank(confidence: str) -> int:
    return 0 if confidence == "high" else 1


def _screenshot_sort_key(screenshot: dict[str, Any]) -> tuple[int, int]:
    confidence = str(screenshot.get("confidence", "low"))
    return (_confidence_rank(confidence), -int(screenshot["ts"]))


def _step_midpoint_ts(step: dict[str, Any], events_by_id: dict[str, dict[str, Any]]) -> float:
    timestamps = [
        int(events_by_id[str(event_id)]["ts"])
        for event_id in step.get("eventIds", [])
        if str(event_id) in events_by_id
    ]
    if timestamps:
        return sum(timestamps) / len(timestamps)
    return 0.0


def _linked_screenshots(
    event_ids: set[str],
    screenshots: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        screenshot
        for screenshot in screenshots
        if screenshot.get("eventId") is not None
        and str(screenshot["eventId"]) in event_ids
    ]


def _pointer_event_ids(
    event_ids: set[str],
    events_by_id: dict[str, dict[str, Any]],
) -> set[str]:
    return {
        event_id
        for event_id in event_ids
        if event_id in events_by_id
        and str(events_by_id[event_id].get("type")) in POINTER_EVENT_TYPES
    }


def _nearest_screenshot(
    screenshots: list[dict[str, Any]],
    midpoint_ts: float,
) -> dict[str, Any]:
    def nearest_sort_key(screenshot: dict[str, Any]) -> tuple[int, float, int]:
        confidence = str(screenshot.get("confidence", "low"))
        distance = abs(int(screenshot["ts"]) - midpoint_ts)
        return (_confidence_rank(confidence), distance, -int(screenshot["ts"]))

    return min(screenshots, key=nearest_sort_key)


def _append_unique_ids(target: list[str], seen: set[str], ids: list[str]) -> None:
    for item_id in ids:
        if item_id and item_id not in seen:
            seen.add(item_id)
            target.append(item_id)


def _build_candidate_ids(
    primary: dict[str, Any] | None,
    linked: list[dict[str, Any]],
) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    if primary is not None:
        raw_candidates = primary.get("candidates")
        if isinstance(raw_candidates, list):
            _append_unique_ids(
                candidates,
                seen,
                [str(candidate) for candidate in raw_candidates],
            )

    for screenshot in linked:
        screenshot_id = str(screenshot["id"])
        if primary is None or screenshot_id != str(primary["id"]):
            _append_unique_ids(candidates, seen, [screenshot_id])

        raw_candidates = screenshot.get("candidates")
        if isinstance(raw_candidates, list):
            _append_unique_ids(
                candidates,
                seen,
                [str(candidate) for candidate in raw_candidates],
            )

    return candidates


def match_step_screenshot(
    step: dict[str, Any],
    screenshots: list[dict[str, Any]],
    *,
    events_by_id: dict[str, dict[str, Any]],
) -> tuple[str | None, bool, list[str]]:
    """Подобрать основной скрин, флаг needsReview и candidates для шага."""
    if not screenshots:
        return None, True, []

    event_ids = {str(event_id) for event_id in step.get("eventIds", [])}
    pointer_ids = _pointer_event_ids(event_ids, events_by_id)
    pointer_linked = _linked_screenshots(pointer_ids, screenshots) if pointer_ids else []
    linked = _linked_screenshots(event_ids, screenshots)
    midpoint_ts = _step_midpoint_ts(step, events_by_id)

    if pointer_linked:
        primary = min(pointer_linked, key=_screenshot_sort_key)
        confidence = str(primary.get("confidence", "low"))
        needs_review = confidence != "high"
        candidate_pool = linked if linked else pointer_linked
        candidates = _build_candidate_ids(primary, candidate_pool)
        return str(primary["id"]), needs_review, candidates

    if linked:
        primary = min(linked, key=_screenshot_sort_key)
        confidence = str(primary.get("confidence", "low"))
        needs_review = confidence != "high"
        candidates = _build_candidate_ids(primary, linked)
        return str(primary["id"]), needs_review, candidates

    primary = _nearest_screenshot(screenshots, midpoint_ts)
    candidates = _build_candidate_ids(primary, [primary])
    return str(primary["id"]), True, candidates


def refine_generated_doc_screenshots(
    doc: GeneratedDoc | dict[str, Any],
    screenshots: list[dict[str, Any]],
    *,
    events: list[dict[str, Any]] | None = None,
) -> RefinedGeneratedDoc:
    """Уточнить screenshotId, needsReview и screenshotCandidates у каждого шага."""
    refined = copy.deepcopy(doc)
    events_by_id = {str(event["id"]): event for event in (events or [])}

    refined_steps: list[RefinedStep] = []
    raw_steps = cast(list[dict[str, Any]], refined["steps"])
    for step in raw_steps:
        screenshot_id, needs_review, candidates = match_step_screenshot(
            step,
            screenshots,
            events_by_id=events_by_id,
        )

        merged_needs_review = bool(step.get("needsReview", False)) or needs_review
        if screenshot_id is None:
            merged_needs_review = True

        refined_step = cast(
            RefinedStep,
            {
                **step,
                "screenshotId": screenshot_id,
                "needsReview": merged_needs_review,
                "screenshotCandidates": candidates,
            },
        )
        refined_steps.append(refined_step)

    refined_dict = cast(dict[str, Any], refined)
    refined_dict["steps"] = refined_steps

    logger.info(
        "Screenshot match refined %d steps",
        len(refined_steps),
    )
    return cast(RefinedGeneratedDoc, refined)


def refine_generated_doc_from_timeline(
    doc: GeneratedDoc | dict[str, Any],
    timeline: dict[str, Any],
) -> RefinedGeneratedDoc:
    screenshots = cast(list[dict[str, Any]], timeline.get("screenshots", []))
    events = cast(list[dict[str, Any]], timeline.get("events", []))
    return refine_generated_doc_screenshots(doc, screenshots, events=events)
