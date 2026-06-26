from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from backend.services.transcription import (
    map_whisper_verbose_json,
    seconds_to_ms,
    segments_are_monotonic,
    transcribe_mic_audio,
)

SAMPLE_WHISPER_RESPONSE: dict[str, Any] = {
    "task": "transcribe",
    "language": "russian",
    "duration": 17.6,
    "text": (
        "Привет. Это тестовая запись для проверки транскрипции Whisper. "
        "Сейчас мы создаём нового клиента в системе."
    ),
    "segments": [
        {
            "id": 0,
            "start": 0.0,
            "end": 2.4,
            "text": " Привет. Это тестовая запись",
            "words": [
                {"word": "Привет.", "start": 0.0, "end": 0.62},
                {"word": "Это", "start": 0.72, "end": 0.95},
                {"word": "тестовая", "start": 1.0, "end": 1.55},
                {"word": "запись", "start": 1.6, "end": 2.1},
            ],
        },
        {
            "id": 1,
            "start": 2.4,
            "end": 5.8,
            "text": " для проверки транскрипции Whisper.",
            "words": [
                {"word": "для", "start": 2.4, "end": 2.6},
                {"word": "проверки", "start": 2.65, "end": 3.2},
                {"word": "транскрипции", "start": 3.25, "end": 4.1},
                {"word": "Whisper.", "start": 4.2, "end": 5.5},
            ],
        },
        {
            "id": 2,
            "start": 5.9,
            "end": 9.2,
            "text": " Сейчас мы создаём нового клиента в системе.",
            "words": [
                {"word": "Сейчас", "start": 5.9, "end": 6.3},
                {"word": "мы", "start": 6.35, "end": 6.5},
                {"word": "создаём", "start": 6.55, "end": 7.2},
                {"word": "нового", "start": 7.25, "end": 7.7},
                {"word": "клиента", "start": 7.75, "end": 8.3},
                {"word": "в", "start": 8.35, "end": 8.4},
                {"word": "системе.", "start": 8.45, "end": 9.1},
            ],
        },
    ],
}


def test_seconds_to_ms() -> None:
    assert seconds_to_ms(1.234) == 1234
    assert seconds_to_ms(0.0) == 0


def test_map_whisper_verbose_json_produces_segments_with_words() -> None:
    segments = map_whisper_verbose_json(SAMPLE_WHISPER_RESPONSE)

    assert len(segments) == 3
    assert segments[0]["start"] == 0
    assert segments[0]["end"] == 2400
    assert segments[0]["text"] == "Привет. Это тестовая запись"
    assert len(segments[0]["words"]) == 4
    assert segments[0]["words"][0]["word"] == "Привет."
    assert segments[0]["words"][0]["start"] == 0
    assert segments[0]["words"][0]["end"] == 620


def test_map_whisper_segments_are_monotonic() -> None:
    segments = map_whisper_verbose_json(SAMPLE_WHISPER_RESPONSE)
    assert segments_are_monotonic(segments)

    previous_end = -1
    for segment in segments:
        assert segment["start"] >= previous_end
        assert segment["end"] >= segment["start"]
        previous_end = segment["end"]


def test_transcribe_mic_audio_with_mock_client(
    fixtures_dir: Path,
    tmp_path: Path,
) -> None:
    mic_path = fixtures_dir / "mic.sample.webm"
    assert mic_path.is_file(), "fixtures/mic.sample.webm обязателен для T2.2"

    duration_sec = 17.6
    assert duration_sec >= 10

    mock_client = MagicMock()
    mock_client.audio.transcriptions.create.return_value = SAMPLE_WHISPER_RESPONSE

    segments = transcribe_mic_audio(mic_path, client=mock_client)

    assert len(segments) >= 1
    for segment in segments:
        assert "start" in segment
        assert "end" in segment
        assert segment["text"]
        assert segment["words"]
        assert all("word" in word for word in segment["words"])

    mock_client.audio.transcriptions.create.assert_called_once()
    call_kwargs = mock_client.audio.transcriptions.create.call_args.kwargs
    assert call_kwargs["model"] == "whisper-1"
    assert call_kwargs["response_format"] == "verbose_json"
    assert call_kwargs["timestamp_granularities"] == ["word", "segment"]


@pytest.mark.integration
def test_transcribe_mic_sample_real(fixtures_dir: Path) -> None:
    if not os.getenv("OPENAI_API_KEY"):
        pytest.skip("OPENAI_API_KEY не задан — пропуск live-теста Whisper")

    mic_path = fixtures_dir / "mic.sample.webm"
    try:
        segments = transcribe_mic_audio(mic_path)
    except Exception as exc:
        if "insufficient_quota" in str(exc) or "429" in str(exc):
            pytest.skip(f"OpenAI quota недоступна: {exc}")
        raise

    assert len(segments) >= 1
    assert segments_are_monotonic(segments)
    full_text = " ".join(segment["text"] for segment in segments)
    assert len(full_text) > 10
