from __future__ import annotations

import json
import logging
from typing import Any, TypedDict, cast

from jsonschema import Draft202012Validator
from openai import OpenAI

from backend.config import (
    get_generate_model,
    get_generate_prompt_path,
    get_openai_api_key,
    get_timeline_schema_path,
)
from backend.services.merge import MergedTimeline, merge_timeline

logger = logging.getLogger(__name__)


class DocStep(TypedDict):
    id: str
    title: str
    body: str
    screenshotId: str | None
    eventIds: list[str]
    needsReview: bool


class GeneratedDoc(TypedDict):
    title: str
    purpose: str
    audience: str
    prerequisites: str
    steps: list[DocStep]
    warnings: list[str]
    result: str


class GenerationError(RuntimeError):
    pass


def load_timeline_schema() -> dict[str, Any]:
    return cast(
        dict[str, Any],
        json.loads(get_timeline_schema_path().read_text(encoding="utf-8")),
    )


def load_generate_prompt() -> str:
    return get_generate_prompt_path().read_text(encoding="utf-8")


def generated_doc_json_schema() -> dict[str, Any]:
    schema = load_timeline_schema()
    defs = cast(dict[str, Any], schema["$defs"])
    generated = cast(dict[str, Any], defs["GeneratedDoc"])
    return {
        "type": "object",
        "additionalProperties": generated.get("additionalProperties", False),
        "required": generated["required"],
        "properties": generated["properties"],
        "$defs": defs,
    }


def generated_doc_strict_schema() -> dict[str, Any]:
    """Схема под OpenAI structured outputs (strict).

    Требования OpenAI: все свойства в required, additionalProperties:false и
    БЕЗ неподдерживаемых ключей (minLength/minimum/minItems/format/$ref/$defs).
    Поэтому отдаём плоскую схему ровно под форму, которую возвращает LLM
    (шаг без screenshotCandidates/screenshotAnnotation — их проставляют позже).
    """
    step = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "id",
            "title",
            "body",
            "screenshotId",
            "eventIds",
            "needsReview",
        ],
        "properties": {
            "id": {"type": "string"},
            "title": {"type": "string"},
            "body": {"type": "string"},
            "screenshotId": {"type": ["string", "null"]},
            "eventIds": {"type": "array", "items": {"type": "string"}},
            "needsReview": {"type": "boolean"},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "title",
            "purpose",
            "audience",
            "prerequisites",
            "steps",
            "warnings",
            "result",
        ],
        "properties": {
            "title": {"type": "string"},
            "purpose": {"type": "string"},
            "audience": {"type": "string"},
            "prerequisites": {"type": "string"},
            "steps": {"type": "array", "items": step},
            "warnings": {"type": "array", "items": {"type": "string"}},
            "result": {"type": "string"},
        },
    }


def validate_generated_doc_shape(doc: dict[str, Any]) -> None:
    validator = Draft202012Validator(generated_doc_json_schema())
    errors = sorted(validator.iter_errors(doc), key=lambda err: err.path)
    if errors:
        raise GenerationError(f"GeneratedDoc не прошёл схему: {errors[0].message}")


def collect_known_event_ids(merged: MergedTimeline) -> set[str]:
    return {
        entry["id"]
        for entry in merged["entries"]
        if entry["kind"] == "event"
    }


def collect_known_screenshot_ids(merged: MergedTimeline) -> set[str]:
    return {
        entry["id"]
        for entry in merged["entries"]
        if entry["kind"] == "screenshot"
    }


def validate_generated_doc_against_timeline(
    doc: dict[str, Any],
    merged: MergedTimeline,
) -> None:
    validate_generated_doc_shape(doc)

    known_events = collect_known_event_ids(merged)
    known_screenshots = collect_known_screenshot_ids(merged)

    for step in doc["steps"]:
        if not isinstance(step, dict):
            raise GenerationError("Шаг документа должен быть объектом")

        event_ids = step.get("eventIds", [])
        if not isinstance(event_ids, list):
            raise GenerationError("eventIds шага должен быть массивом")

        unknown_events = [
            str(event_id)
            for event_id in event_ids
            if str(event_id) not in known_events
        ]
        if unknown_events:
            raise GenerationError(
                f"Выдуманные eventIds в шаге {step.get('id')}: {unknown_events}",
            )

        screenshot_id = step.get("screenshotId")
        if screenshot_id is not None and str(screenshot_id) not in known_screenshots:
            raise GenerationError(
                f"Неизвестный screenshotId в шаге {step.get('id')}: {screenshot_id}",
            )


def build_generation_context(merged: MergedTimeline) -> dict[str, Any]:
    meta = merged["meta"]
    screenshots = [
        entry["data"] for entry in merged["entries"] if entry["kind"] == "screenshot"
    ]

    preliminary_steps = []
    for step in merged["steps"]:
        payload: dict[str, Any] = {
            "id": step["id"],
            "speechText": step["speechText"],
            "speechStartMs": step["speechStart"],
            "speechEndMs": step["speechEnd"],
            "suggestedScreenshotId": step["screenshotId"],
            "screenshotConfidence": step["screenshotConfidence"],
            "screenshotCandidates": step["screenshotCandidates"],
            "events": step["events"],
        }
        vision_events = step.get("visionEventDescriptions")
        if isinstance(vision_events, dict) and vision_events:
            payload["visionEventDescriptions"] = vision_events
        vision_screenshot = step.get("visionScreenshotDescription")
        if isinstance(vision_screenshot, str) and vision_screenshot.strip():
            payload["visionScreenshotDescription"] = vision_screenshot.strip()
        preliminary_steps.append(payload)

    return {
        "recording": {
            "url": meta.get("url"),
            "title": meta.get("title"),
            "durationMs": meta.get("durationMs"),
        },
        "preliminarySteps": preliminary_steps,
        "screenshots": screenshots,
        "knownEventIds": sorted(collect_known_event_ids(merged)),
    }


def parse_generated_doc(raw: dict[str, Any]) -> GeneratedDoc:
    return cast(GeneratedDoc, raw)


def _extract_response_json(response: Any) -> dict[str, Any]:
    content = response.choices[0].message.content
    if not content:
        raise GenerationError("LLM вернул пустой ответ")
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise GenerationError("LLM вернул не объект JSON")
    return cast(dict[str, Any], parsed)


def generate_document(
    merged: MergedTimeline,
    *,
    client: OpenAI | None = None,
) -> GeneratedDoc:
    """Сгенерировать GeneratedDoc из merged_timeline через LLM."""
    if not merged["steps"]:
        raise GenerationError("Нет предварительных шагов для генерации документа")

    api_key = get_openai_api_key()
    openai_client = client or OpenAI(api_key=api_key)
    model = get_generate_model()
    system_prompt = load_generate_prompt()
    user_payload = build_generation_context(merged)

    logger.info(
        "LLM document generation start: recording=%s model=%s",
        merged["meta"].get("recordingId"),
        model,
    )

    response = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(user_payload, ensure_ascii=False, indent=2),
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "generated_doc",
                "strict": True,
                "schema": generated_doc_strict_schema(),
            },
        },
    )

    doc = _extract_response_json(response)
    validate_generated_doc_against_timeline(doc, merged)

    logger.info(
        "LLM document generation done: %d steps",
        len(doc.get("steps", [])),
    )
    return parse_generated_doc(doc)


def generate_document_from_timeline(
    timeline: dict[str, Any],
    *,
    client: OpenAI | None = None,
) -> GeneratedDoc:
    merged = merge_timeline(timeline)
    return generate_document(merged, client=client)
