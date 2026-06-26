from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, Response
from sqlalchemy.orm import Session

from backend.config import get_storage_root
from backend.models import get_db_session, get_recording
from backend.services.generate import GenerationError, validate_generated_doc_shape
from backend.services.render import render_html, render_markdown
from backend.storage import load_generated_doc, save_generated_doc

router = APIRouter(tags=["doc"])

DocFormat = Literal["md", "html", "json"]


@router.get("/recording/{recording_id}/doc")
def get_recording_doc(
    recording_id: str,
    doc_format: Annotated[DocFormat, Query(alias="format")] = "html",
    session: Session = Depends(get_db_session),
) -> Response:
    recording = get_recording(session, recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    doc = load_generated_doc(get_storage_root(), recording_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Документ ещё не сгенерирован")

    if doc_format == "json":
        return JSONResponse(content=doc)

    if doc_format == "md":
        content = render_markdown(doc)
        return Response(content=content, media_type="text/markdown; charset=utf-8")

    content = render_html(doc)
    return HTMLResponse(content=content)


@router.put("/recording/{recording_id}/doc")
def put_recording_doc(
    recording_id: str,
    body: Annotated[dict[str, Any], Body()],
    session: Session = Depends(get_db_session),
) -> dict[str, Any]:
    recording = get_recording(session, recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    try:
        validate_generated_doc_shape(body)
    except GenerationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    save_generated_doc(get_storage_root(), recording_id, body)
    return body
