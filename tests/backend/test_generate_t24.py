from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, cast
from unittest.mock import MagicMock

import pytest

from backend.services.generate import (
    GenerationError,
    build_generation_context,
    generate_document,
    validate_generated_doc_against_timeline,
    validate_generated_doc_shape,
)
from backend.services.merge import merge_timeline


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


def test_build_generation_context_from_mock_timeline(fixtures_dir: Path) -> None:
    merged = merge_timeline(_load_mock_timeline(fixtures_dir))
    context = build_generation_context(merged)

    assert context["recording"]["title"] == "Клиенты — Example CRM"
    assert len(context["preliminarySteps"]) == 3
    assert context["knownEventIds"] == [
        "evt-001",
        "evt-002",
        "evt-003",
        "evt-004",
        "evt-005",
        "evt-006",
    ]
    assert len(context["screenshots"]) == 4


def test_mock_generated_doc_passes_schema_and_timeline_validation(
    fixtures_dir: Path,
) -> None:
    timeline = _load_mock_timeline(fixtures_dir)
    merged = merge_timeline(timeline)
    doc = _load_mock_generated_doc(fixtures_dir)

    validate_generated_doc_shape(doc)
    validate_generated_doc_against_timeline(doc, merged)

    assert 4 <= len(doc["steps"]) <= 6
    assert doc["purpose"]
    assert doc["audience"]
    assert doc["warnings"]
    assert doc["result"]

    screenshot_ids = {step["screenshotId"] for step in doc["steps"]}
    assert screenshot_ids <= {"scr-001", "scr-002", "scr-003"}

    used_event_ids = {event_id for step in doc["steps"] for event_id in step["eventIds"]}
    assert used_event_ids == {
        "evt-001",
        "evt-002",
        "evt-003",
        "evt-004",
        "evt-005",
        "evt-006",
    }


def test_rejects_invented_event_ids(fixtures_dir: Path) -> None:
    merged = merge_timeline(_load_mock_timeline(fixtures_dir))
    doc = _load_mock_generated_doc(fixtures_dir)
    doc["steps"][0]["eventIds"].append("evt-999")

    with pytest.raises(GenerationError, match="Выдуманные eventIds"):
        validate_generated_doc_against_timeline(doc, merged)


def test_generate_document_with_mock_client(fixtures_dir: Path) -> None:
    merged = merge_timeline(_load_mock_timeline(fixtures_dir))
    mock_doc = _load_mock_generated_doc(fixtures_dir)

    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = json.dumps(mock_doc, ensure_ascii=False)

    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_response

    doc = generate_document(merged, client=mock_client)

    assert doc["title"] == mock_doc["title"]
    assert len(doc["steps"]) == 4
    assert doc["steps"][0]["screenshotId"] == "scr-001"

    call_kwargs = mock_client.chat.completions.create.call_args.kwargs
    assert call_kwargs["response_format"]["type"] == "json_schema"
    assert call_kwargs["response_format"]["json_schema"]["name"] == "generated_doc"
    messages = call_kwargs["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    user_payload = json.loads(messages[1]["content"])
    assert user_payload["knownEventIds"]


@pytest.mark.integration
def test_generate_document_live(fixtures_dir: Path) -> None:
    if not os.getenv("OPENAI_API_KEY"):
        pytest.skip("OPENAI_API_KEY не задан — пропуск live-теста LLM")

    merged = merge_timeline(_load_mock_timeline(fixtures_dir))
    try:
        doc = generate_document(merged)
    except Exception as exc:
        if "insufficient_quota" in str(exc) or "429" in str(exc):
            pytest.skip(f"OpenAI quota недоступна: {exc}")
        raise

    assert 4 <= len(doc["steps"]) <= 6
    assert doc["purpose"]
    assert doc["audience"]
    assert doc["result"]
    validate_generated_doc_against_timeline(cast(dict[str, Any], doc), merged)
