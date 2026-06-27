from __future__ import annotations

import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, cast

from jsonschema import Draft202012Validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.config import get_timeline_schema_path
from backend.models import Job, Recording

# Тот же паттерн, что и в timeline.schema.json. Защита от path traversal: recordingId
# приходит из клиента и подставляется в путь файловой системы.
RECORDING_ID_RE = re.compile(r"^rec-[A-Za-z0-9_-]{1,80}$")


class TimelineValidationError(ValueError):
    pass


def validate_recording_id(recording_id: str) -> str:
    if not isinstance(recording_id, str) or not RECORDING_ID_RE.match(recording_id):
        raise TimelineValidationError(f"Недопустимый recordingId: {recording_id!r}")
    return recording_id


def load_timeline_schema() -> dict[str, Any]:
    schema_path = get_timeline_schema_path()
    return cast(dict[str, Any], json.loads(schema_path.read_text(encoding="utf-8")))


def validate_timeline(timeline: dict[str, Any]) -> None:
    schema = load_timeline_schema()
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(timeline), key=lambda err: err.path)
    if errors:
        message = errors[0].message
        raise TimelineValidationError(f"timeline.json не прошёл схему: {message}")


def generate_job_id() -> str:
    return f"job-{uuid.uuid4().hex}"


def recording_dir(storage_root: Path, recording_id: str) -> Path:
    return storage_root / recording_id


def generated_doc_path(storage_root: Path, recording_id: str) -> Path:
    return recording_dir(storage_root, recording_id) / "generated_doc.json"


def save_generated_doc(
    storage_root: Path,
    recording_id: str,
    doc: dict[str, Any],
) -> Path:
    path = generated_doc_path(storage_root, recording_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_generated_doc(storage_root: Path, recording_id: str) -> dict[str, Any] | None:
    path = generated_doc_path(storage_root, recording_id)
    if not path.is_file():
        return None
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def load_timeline(storage_root: Path, recording_id: str) -> dict[str, Any] | None:
    path = recording_dir(storage_root, recording_id) / "timeline.json"
    if not path.is_file():
        return None
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def save_recording_artifacts(
    session: Session,
    *,
    storage_root: Path,
    timeline: dict[str, Any],
    mic_bytes: bytes,
    screenshot_files: list[tuple[str, bytes]],
    video_bytes: bytes | None = None,
) -> tuple[str, str]:
    validate_timeline(timeline)

    recording_id = validate_recording_id(timeline["meta"]["recordingId"])
    target_dir = recording_dir(storage_root, recording_id)
    screenshots_dir = target_dir / "screenshots"
    target_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    (target_dir / "mic.webm").write_bytes(mic_bytes)
    (target_dir / "timeline.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if video_bytes:
        (target_dir / "video.webm").write_bytes(video_bytes)

    for filename, content in screenshot_files:
        safe_name = Path(filename).name
        (screenshots_dir / safe_name).write_bytes(content)

    job_id = generate_job_id()

    existing = session.execute(
        select(Recording).where(Recording.recording_id == recording_id),
    ).scalar_one_or_none()
    if existing is not None:
        session.execute(delete(Job).where(Job.recording_id == recording_id))
        shutil.rmtree(target_dir, ignore_errors=True)
        session.delete(existing)
        session.flush()

    recording = Recording(
        recording_id=recording_id,
        status="received",
        storage_path=str(target_dir),
    )
    job = Job(
        job_id=job_id,
        recording_id=recording_id,
        status="received",
    )
    session.add(recording)
    session.add(job)
    session.commit()

    return recording_id, job_id


def delete_recording(session: Session, *, storage_root: Path, recording_id: str) -> bool:
    validate_recording_id(recording_id)
    recording = session.execute(
        select(Recording).where(Recording.recording_id == recording_id),
    ).scalar_one_or_none()
    if recording is None:
        return False

    session.execute(delete(Job).where(Job.recording_id == recording_id))
    session.delete(recording)
    session.commit()

    shutil.rmtree(recording_dir(storage_root, recording_id), ignore_errors=True)
    return True
