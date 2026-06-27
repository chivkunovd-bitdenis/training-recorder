from __future__ import annotations

import logging
from typing import Any, Literal, NotRequired, TypedDict, cast

logger = logging.getLogger(__name__)

# Сегменты речи с паузой короче этого порога сливаются в один якорь (Whisper-оверсплит).
SPEECH_MERGE_GAP_MS = 400

SIGNIFICANT_ANCHOR_TYPES = frozenset({"click", "submit", "menu_select", "navigation"})
POINTER_EVENT_TYPES = frozenset({"click", "submit", "menu_select"})


class SpeechAnchor(TypedDict):
    start: int
    end: int
    text: str
    segmentIndexes: list[int]


class MergedStreamEntry(TypedDict):
    kind: Literal["speech", "event", "screenshot"]
    ts: int
    id: str
    data: dict[str, Any]


class PreliminaryStep(TypedDict):
    id: str
    speechStart: int
    speechEnd: int
    speechText: str
    eventIds: list[str]
    events: list[dict[str, Any]]
    screenshotId: str | None
    screenshotConfidence: Literal["high", "low"] | None
    screenshotCandidates: list[str]
    visionEventDescriptions: NotRequired[dict[str, str]]
    visionScreenshotDescription: NotRequired[str]


class MergedTimeline(TypedDict):
    meta: dict[str, Any]
    entries: list[MergedStreamEntry]
    steps: list[PreliminaryStep]


def apply_transcript_offset(
    transcript: list[dict[str, Any]],
    mic_offset_ms: int,
) -> list[dict[str, Any]]:
    """Сдвинуть таймкоды транскрипта на общую ось t0.

    Whisper отдаёт время от начала аудиофайла, а аудио стартует на t0 + micStartOffsetMs.
    События и скрины уже в осях t0, поэтому к транскрипту прибавляем micStartOffsetMs,
    иначе голос и действия разъезжаются.
    """
    if not mic_offset_ms:
        return transcript

    shifted: list[dict[str, Any]] = []
    for segment in transcript:
        new_segment = dict(segment)
        new_segment["start"] = int(segment["start"]) + mic_offset_ms
        new_segment["end"] = int(segment["end"]) + mic_offset_ms
        words = segment.get("words")
        if isinstance(words, list):
            new_segment["words"] = [
                {
                    **word,
                    "start": int(word["start"]) + mic_offset_ms,
                    "end": int(word["end"]) + mic_offset_ms,
                }
                for word in words
            ]
        shifted.append(new_segment)
    return shifted


def _speech_anchor_ts(segment: dict[str, Any]) -> int:
    return int(segment["start"])


def build_speech_anchors(
    segments: list[dict[str, Any]],
    *,
    merge_gap_ms: int = SPEECH_MERGE_GAP_MS,
) -> list[SpeechAnchor]:
    if not segments:
        return []

    anchors: list[SpeechAnchor] = []
    first = segments[0]
    current = SpeechAnchor(
        start=int(first["start"]),
        end=int(first["end"]),
        text=str(first["text"]).strip(),
        segmentIndexes=[0],
    )

    for index, segment in enumerate(segments[1:], start=1):
        gap = int(segment["start"]) - current["end"]
        if gap < merge_gap_ms:
            current["end"] = int(segment["end"])
            current["text"] = f"{current['text']} {str(segment['text']).strip()}".strip()
            current["segmentIndexes"].append(index)
        else:
            anchors.append(current)
            current = SpeechAnchor(
                start=int(segment["start"]),
                end=int(segment["end"]),
                text=str(segment["text"]).strip(),
                segmentIndexes=[index],
            )

    anchors.append(current)
    return anchors


def build_sorted_entries(
    *,
    transcript: list[dict[str, Any]],
    events: list[dict[str, Any]],
    screenshots: list[dict[str, Any]],
) -> list[MergedStreamEntry]:
    entries: list[MergedStreamEntry] = []

    for index, segment in enumerate(transcript):
        entries.append(
            MergedStreamEntry(
                kind="speech",
                ts=_speech_anchor_ts(segment),
                id=f"speech-{index}",
                data=segment,
            ),
        )

    for event in events:
        entries.append(
            MergedStreamEntry(
                kind="event",
                ts=int(event["ts"]),
                id=str(event["id"]),
                data=event,
            ),
        )

    for screenshot in screenshots:
        entries.append(
            MergedStreamEntry(
                kind="screenshot",
                ts=int(screenshot["ts"]),
                id=str(screenshot["id"]),
                data=screenshot,
            ),
        )

    entries.sort(key=lambda entry: (entry["ts"], entry["kind"], entry["id"]))
    return entries


def _events_for_anchor_window(
    events: list[dict[str, Any]],
    window_start: int,
    window_end: int | None,
) -> list[dict[str, Any]]:
    matched: list[dict[str, Any]] = []
    for event in events:
        ts = int(event["ts"])
        if ts < window_start:
            continue
        if window_end is not None and ts >= window_end:
            continue
        matched.append(event)
    return matched


def _confidence_rank(confidence: str) -> int:
    return 0 if confidence == "high" else 1


def _pick_primary_anchor_event(
    step_events: list[dict[str, Any]],
    *,
    speech_start: int,
    speech_end: int,
) -> dict[str, Any] | None:
    """Ближайший значимый клик/submit/navigation к реплике — якорь шага."""
    anchors = [
        event
        for event in step_events
        if str(event.get("type")) in SIGNIFICANT_ANCHOR_TYPES
    ]
    if not anchors:
        return None

    pointer_events = [
        event
        for event in anchors
        if str(event.get("type")) in POINTER_EVENT_TYPES
    ]
    pool = pointer_events if pointer_events else anchors
    if len(pool) == 1:
        return pool[0]

    midpoint = (speech_start + speech_end) / 2
    return min(pool, key=lambda event: abs(int(event["ts"]) - midpoint))


def _build_step_event_ids(
    step_events: list[dict[str, Any]],
    primary_event: dict[str, Any] | None,
) -> list[str]:
    if primary_event is None:
        return [str(event["id"]) for event in step_events]

    primary_id = str(primary_event["id"])
    context_events = [
        event for event in step_events if str(event["id"]) != primary_id
    ]
    context_events.sort(key=lambda event: int(event["ts"]))
    return [primary_id] + [str(event["id"]) for event in context_events]


def _pick_screenshot_for_step(
    step_events: list[dict[str, Any]],
    screenshots: list[dict[str, Any]],
    *,
    speech_start: int,
    speech_end: int,
    primary_event: dict[str, Any] | None = None,
) -> tuple[str | None, Literal["high", "low"] | None, list[str]]:
    if not screenshots:
        return None, None, []

    def screenshot_sort_key(screenshot: dict[str, Any]) -> tuple[int, int]:
        confidence = str(screenshot.get("confidence", "low"))
        return (_confidence_rank(confidence), -int(screenshot["ts"]))

    pointer_event_ids: set[str] = set()
    if primary_event is not None and str(primary_event.get("type")) in POINTER_EVENT_TYPES:
        pointer_event_ids.add(str(primary_event["id"]))
    else:
        pointer_event_ids = {
            str(event["id"])
            for event in step_events
            if str(event.get("type")) in POINTER_EVENT_TYPES
        }

    if pointer_event_ids:
        pointer_linked = [
            screenshot
            for screenshot in screenshots
            if screenshot.get("eventId") is not None
            and str(screenshot["eventId"]) in pointer_event_ids
        ]
        if pointer_linked:
            best = min(pointer_linked, key=screenshot_sort_key)
            confidence = cast(Literal["high", "low"], str(best.get("confidence", "low")))
            candidates_raw = best.get("candidates")
            candidates = (
                [str(candidate) for candidate in candidates_raw]
                if isinstance(candidates_raw, list)
                else []
            )
            return str(best["id"]), confidence, candidates

    event_ids = {str(event["id"]) for event in step_events}
    linked = [
        screenshot
        for screenshot in screenshots
        if screenshot.get("eventId") is not None
        and str(screenshot["eventId"]) in event_ids
    ]

    pool = linked if linked else screenshots

    if step_events:
        midpoint = sum(int(event["ts"]) for event in step_events) / len(step_events)
    else:
        midpoint = (speech_start + speech_end) / 2

    def nearest_sort_key(screenshot: dict[str, Any]) -> tuple[int, float, int]:
        confidence = str(screenshot.get("confidence", "low"))
        distance = abs(int(screenshot["ts"]) - midpoint)
        return (_confidence_rank(confidence), distance, -int(screenshot["ts"]))

    if linked:
        best = min(linked, key=screenshot_sort_key)
    else:
        best = min(pool, key=nearest_sort_key)

    confidence = cast(Literal["high", "low"], str(best.get("confidence", "low")))
    candidates_raw = best.get("candidates")
    candidates = (
        [str(candidate) for candidate in candidates_raw]
        if isinstance(candidates_raw, list)
        else []
    )
    return str(best["id"]), confidence, candidates


def build_preliminary_steps(
    *,
    anchors: list[SpeechAnchor],
    events: list[dict[str, Any]],
    screenshots: list[dict[str, Any]],
) -> list[PreliminaryStep]:
    if not anchors:
        return []

    steps: list[PreliminaryStep] = []
    for index, anchor in enumerate(anchors):
        window_end = anchors[index + 1]["start"] if index + 1 < len(anchors) else None
        # Первый шаг забирает и действия до первой реплики (навигация/клики до начала
        # рассказа), иначе они выпадают из документа.
        window_start = 0 if index == 0 else anchor["start"]
        step_events = _events_for_anchor_window(events, window_start, window_end)
        primary_event = _pick_primary_anchor_event(
            step_events,
            speech_start=anchor["start"],
            speech_end=anchor["end"],
        )
        step_event_ids = _build_step_event_ids(step_events, primary_event)
        screenshot_id, screenshot_confidence, screenshot_candidates = _pick_screenshot_for_step(
            step_events,
            screenshots,
            speech_start=anchor["start"],
            speech_end=anchor["end"],
            primary_event=primary_event,
        )

        steps.append(
            PreliminaryStep(
                id=f"prelim-{index + 1:03d}",
                speechStart=anchor["start"],
                speechEnd=anchor["end"],
                speechText=anchor["text"],
                eventIds=step_event_ids,
                events=step_events,
                screenshotId=screenshot_id,
                screenshotConfidence=screenshot_confidence,
                screenshotCandidates=screenshot_candidates,
            ),
        )

    return steps


def merge_timeline(timeline: dict[str, Any]) -> MergedTimeline:
    """Слить транскрипт, события и скрины; сгруппировать в предварительные шаги."""
    meta = cast(dict[str, Any], timeline["meta"])
    events = cast(list[dict[str, Any]], timeline.get("events", []))
    screenshots = cast(list[dict[str, Any]], timeline.get("screenshots", []))
    transcript_raw = cast(list[dict[str, Any]], timeline.get("transcript", []))
    mic_offset_ms = int(round(float(meta.get("micStartOffsetMs", 0) or 0)))
    transcript = apply_transcript_offset(transcript_raw, mic_offset_ms)

    anchors = build_speech_anchors(transcript)
    entries = build_sorted_entries(
        transcript=transcript,
        events=events,
        screenshots=screenshots,
    )
    steps = build_preliminary_steps(
        anchors=anchors,
        events=events,
        screenshots=screenshots,
    )

    logger.info(
        "Merged timeline %s: %d entries, %d preliminary steps",
        meta.get("recordingId"),
        len(entries),
        len(steps),
    )

    return MergedTimeline(
        meta=meta,
        entries=entries,
        steps=steps,
    )
