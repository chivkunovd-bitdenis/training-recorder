from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import get_storage_root
from backend.models import get_db_session
from backend.storage import (
    TimelineValidationError,
    delete_recording,
    save_recording_artifacts,
)

router = APIRouter(tags=["process"])


class ProcessResponse(BaseModel):
    recordingId: str
    jobId: str
    status: str


class DeleteResponse(BaseModel):
    recordingId: str
    deleted: bool


async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"Файл {file.filename} пустой")
    return content


@router.post("/process", response_model=ProcessResponse)
async def process_recording(
    mic: Annotated[UploadFile, File(...)],
    timeline: Annotated[UploadFile, File(...)],
    screenshots: Annotated[list[UploadFile], File(default_factory=list)],
    video: Annotated[UploadFile | None, File()] = None,
    session: Session = Depends(get_db_session),
) -> ProcessResponse:
    mic_bytes = await _read_upload(mic)

    timeline_bytes = await timeline.read()
    try:
        timeline_data = json.loads(timeline_bytes.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="timeline.json невалидный JSON") from exc

    screenshot_files: list[tuple[str, bytes]] = []
    for upload in screenshots:
        filename = upload.filename or "screenshot.jpg"
        screenshot_files.append((filename, await _read_upload(upload)))

    video_bytes = None
    if video is not None and video.filename:
        video_bytes = await _read_upload(video)

    try:
        recording_id, job_id = save_recording_artifacts(
            session,
            storage_root=get_storage_root(),
            timeline=timeline_data,
            mic_bytes=mic_bytes,
            screenshot_files=screenshot_files,
            video_bytes=video_bytes,
        )
    except TimelineValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return ProcessResponse(
        recordingId=recording_id,
        jobId=job_id,
        status="received",
    )


@router.delete("/recording/{recording_id}", response_model=DeleteResponse)
def delete_recording_endpoint(
    recording_id: str,
    session: Session = Depends(get_db_session),
) -> DeleteResponse:
    try:
        deleted = delete_recording(
            session,
            storage_root=get_storage_root(),
            recording_id=recording_id,
        )
    except TimelineValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return DeleteResponse(recordingId=recording_id, deleted=True)
