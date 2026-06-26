from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, cast

from backend.config import get_storage_root
from backend.services.generate import GenerationError, generate_document
from backend.services.merge import merge_timeline
from backend.services.screenshot_match import refine_generated_doc_from_timeline
from backend.services.transcription import TranscriptionError, transcribe_mic_audio
from backend.services.vision import VisionError, enrich_merged_with_vision
from backend.storage import load_timeline, recording_dir, save_generated_doc

logger = logging.getLogger(__name__)


class PipelineError(RuntimeError):
    pass


def run_recording_pipeline(recording_id: str) -> dict[str, Any]:
    """Транскрипция → merge → LLM → screenshot match → generated_doc.json."""
    storage_root = get_storage_root()
    target_dir = recording_dir(storage_root, recording_id)
    timeline = load_timeline(storage_root, recording_id)
    if timeline is None:
        raise PipelineError(f"timeline.json не найден для {recording_id}")

    mic_path = target_dir / "mic.webm"
    if not mic_path.is_file():
        raise PipelineError(f"mic.webm не найден для {recording_id}")

    if not timeline.get("transcript"):
        try:
            timeline["transcript"] = transcribe_mic_audio(mic_path)
        except TranscriptionError as exc:
            raise PipelineError(str(exc)) from exc
        _write_timeline(target_dir, timeline)

    try:
        merged = merge_timeline(timeline)
        try:
            merged, vision_stats = enrich_merged_with_vision(
                merged,
                recording_id,
                storage_root,
            )
            logger.info(
                "Vision enrichment for %s: %d/%d calls",
                recording_id,
                vision_stats.calls_made,
                vision_stats.budget,
            )
        except VisionError as exc:
            logger.warning("Vision fallback skipped for %s: %s", recording_id, exc)
        doc = generate_document(merged)
        refined = refine_generated_doc_from_timeline(doc, timeline)
    except GenerationError as exc:
        raise PipelineError(str(exc)) from exc

    save_generated_doc(storage_root, recording_id, cast(dict[str, Any], refined))
    logger.info("Pipeline completed for %s", recording_id)
    return cast(dict[str, Any], refined)


def _write_timeline(target_dir: Path, timeline: dict[str, Any]) -> None:
    (target_dir / "timeline.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
