from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.config import get_storage_root
from backend.models import get_db_session, get_recording
from backend.services.pipeline import PipelineError, run_recording_pipeline
from backend.storage import load_timeline, recording_dir

router = APIRouter(tags=["recording"])


@router.get("/recording/{recording_id}/timeline")
def get_recording_timeline(
    recording_id: str,
    session: Session = Depends(get_db_session),
) -> dict[str, Any]:
    recording = get_recording(session, recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    timeline = load_timeline(get_storage_root(), recording_id)
    if timeline is None:
        raise HTTPException(status_code=404, detail="timeline.json не найден")

    return timeline


@router.post("/recording/{recording_id}/generate")
def generate_recording_doc(
    recording_id: str,
    session: Session = Depends(get_db_session),
) -> dict[str, Any]:
    recording = get_recording(session, recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    try:
        return run_recording_pipeline(recording_id)
    except PipelineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/recording/{recording_id}/screenshots/{filename}")
def get_recording_screenshot(
    recording_id: str,
    filename: str,
    session: Session = Depends(get_db_session),
) -> FileResponse:
    recording = get_recording(session, recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.endswith(".jpg"):
        raise HTTPException(status_code=400, detail="Недопустимое имя файла скриншота")

    screenshot_path = recording_dir(get_storage_root(), recording_id) / "screenshots" / safe_name
    if not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Скриншот не найден")

    return FileResponse(screenshot_path, media_type="image/jpeg")
