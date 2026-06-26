from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, TypedDict, cast

from openai import OpenAI

from backend.config import get_openai_api_key

logger = logging.getLogger(__name__)

WHISPER_MODEL = "whisper-1"


class TranscriptWord(TypedDict):
    word: str
    start: int
    end: int


class TranscriptSegment(TypedDict):
    start: int
    end: int
    text: str
    words: list[TranscriptWord]


class TranscriptionError(RuntimeError):
    pass


def seconds_to_ms(value: float) -> int:
    return int(round(value * 1000))


def _map_word(raw: dict[str, Any]) -> TranscriptWord | None:
    word = raw.get("word")
    start = raw.get("start")
    end = raw.get("end")
    if not isinstance(word, str) or start is None or end is None:
        return None
    return TranscriptWord(
        word=word,
        start=seconds_to_ms(float(start)),
        end=seconds_to_ms(float(end)),
    )


def map_whisper_verbose_json(response: dict[str, Any]) -> list[TranscriptSegment]:
    """Map Whisper verbose_json to TranscriptSegment[] (timestamps in ms from t0)."""
    segments_raw = response.get("segments")
    if not isinstance(segments_raw, list):
        return []

    segments: list[TranscriptSegment] = []
    for segment_raw in segments_raw:
        if not isinstance(segment_raw, dict):
            continue

        start = segment_raw.get("start")
        end = segment_raw.get("end")
        text = segment_raw.get("text")
        if start is None or end is None or not isinstance(text, str):
            continue

        words_raw = segment_raw.get("words")
        words: list[TranscriptWord] = []
        if isinstance(words_raw, list):
            for word_raw in words_raw:
                if isinstance(word_raw, dict):
                    mapped = _map_word(word_raw)
                    if mapped is not None:
                        words.append(mapped)

        segments.append(
            TranscriptSegment(
                start=seconds_to_ms(float(start)),
                end=seconds_to_ms(float(end)),
                text=text.strip(),
                words=words,
            ),
        )

    return segments


def _response_to_dict(response: Any) -> dict[str, Any]:
    if isinstance(response, dict):
        return cast(dict[str, Any], response)
    if hasattr(response, "model_dump"):
        return cast(dict[str, Any], response.model_dump())
    raise TranscriptionError("Неожиданный формат ответа Whisper")


def segments_are_monotonic(segments: list[TranscriptSegment]) -> bool:
    previous_segment_end = -1
    for segment in segments:
        if segment["start"] < previous_segment_end:
            return False
        if segment["end"] < segment["start"]:
            return False
        previous_segment_end = segment["end"]

        previous_word_end = segment["start"]
        for word in segment.get("words", []):
            if word["start"] < previous_word_end:
                return False
            if word["end"] < word["start"]:
                return False
            previous_word_end = word["end"]
    return True


def transcribe_mic_audio(
    audio_path: Path,
    *,
    client: OpenAI | None = None,
) -> list[TranscriptSegment]:
    """Transcribe mic.webm via Whisper; timestamps are ms from recording t0."""
    if not audio_path.is_file():
        raise TranscriptionError(f"Аудиофайл не найден: {audio_path}")

    api_key = get_openai_api_key()
    openai_client = client or OpenAI(api_key=api_key)

    logger.info("Whisper transcription start: %s", audio_path.name)
    with audio_path.open("rb") as audio_file:
        response = openai_client.audio.transcriptions.create(
            model=WHISPER_MODEL,
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )

    segments = map_whisper_verbose_json(_response_to_dict(response))
    if not segments:
        raise TranscriptionError(
            "В записи не распознан голос. Проговаривайте шаги вслух во время записи "
            "— именно из объяснений формируется инструкция.",
        )

    if not segments_are_monotonic(segments):
        raise TranscriptionError("Таймкоды транскрипта не монотонны")

    logger.info("Whisper transcription done: %d segments", len(segments))
    return segments
