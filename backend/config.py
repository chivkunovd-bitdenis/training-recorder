from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")
BACKEND_ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = BACKEND_ROOT / "data" / "training_recorder.db"
DEFAULT_STORAGE_ROOT = BACKEND_ROOT / "storage"
TIMELINE_SCHEMA_PATH = PROJECT_ROOT / "shared" / "timeline.schema.json"
GENERATE_PROMPT_PATH = BACKEND_ROOT / "prompts" / "generate_doc.md"
VISION_PROMPT_PATH = BACKEND_ROOT / "prompts" / "vision_describe.md"
# Качество итогового документа — главный дифференциатор продукта, поэтому на генерации
# берём модель посильнее (можно переопределить через GENERATE_MODEL). Vision — fallback, mini.
DEFAULT_GENERATE_MODEL = "gpt-4o"
DEFAULT_VISION_MODEL = "gpt-4o-mini"
DEFAULT_VISION_BUDGET_PER_RECORDING = 5
DEFAULT_BACKEND_PUBLIC_URL = "http://127.0.0.1:8000"
EDITOR_DIST_PATH = PROJECT_ROOT / "editor" / "dist"


def get_database_url() -> str:
    return os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")


def get_storage_root() -> Path:
    return Path(os.getenv("STORAGE_ROOT", str(DEFAULT_STORAGE_ROOT)))


def get_timeline_schema_path() -> Path:
    return Path(os.getenv("TIMELINE_SCHEMA_PATH", str(TIMELINE_SCHEMA_PATH)))


def get_openai_api_key() -> str | None:
    return os.getenv("OPENAI_API_KEY")


def get_generate_prompt_path() -> Path:
    return Path(os.getenv("GENERATE_PROMPT_PATH", str(GENERATE_PROMPT_PATH)))


def get_generate_model() -> str:
    return os.getenv("GENERATE_MODEL", DEFAULT_GENERATE_MODEL)


def get_vision_prompt_path() -> Path:
    return Path(os.getenv("VISION_PROMPT_PATH", str(VISION_PROMPT_PATH)))


def get_vision_model() -> str:
    return os.getenv("VISION_MODEL", DEFAULT_VISION_MODEL)


def get_vision_budget_per_recording() -> int:
    raw = os.getenv("VISION_BUDGET_PER_RECORDING")
    if raw is None:
        return DEFAULT_VISION_BUDGET_PER_RECORDING
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_VISION_BUDGET_PER_RECORDING
    return max(0, value)


def get_editor_dist_path() -> Path:
    return Path(os.getenv("EDITOR_DIST_PATH", str(EDITOR_DIST_PATH)))


def get_backend_public_url() -> str:
    return os.getenv("BACKEND_PUBLIC_URL", DEFAULT_BACKEND_PUBLIC_URL).rstrip("/")
