from __future__ import annotations

import base64
import json
import logging
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from backend.config import get_storage_root
from backend.models import get_db_session, get_recording
from backend.services.generate import GenerationError, validate_generated_doc_shape
from backend.services.render import (
    build_markdown_zip,
    export_step_image_path,
    render_html,
    screenshot_relative_path,
    slugify_filename,
)

router = APIRouter(tags=["export"])
logger = logging.getLogger(__name__)

ExportFormat = Literal["md", "html"]
STEP_IMAGE_PREFIX = "step_image_"


def _load_step_image_from_storage(recording_id: str, screenshot_id: str) -> bytes | None:
    # screenshot_id приходит из клиентского документа — берём только имя файла,
    # чтобы исключить выход за пределы папки записи.
    safe_id = Path(screenshot_id).name
    path = get_storage_root() / recording_id / "screenshots" / f"{safe_id}.jpg"
    if not path.is_file():
        return None
    return path.read_bytes()


async def _parse_uploaded_step_images(form: Any) -> dict[str, bytes]:
    images: dict[str, bytes] = {}
    for key, value in form.multi_items():
        if not isinstance(key, str) or not key.startswith(STEP_IMAGE_PREFIX):
            continue
        if not isinstance(value, UploadFile):
            continue
        step_id = key.removeprefix(STEP_IMAGE_PREFIX)
        if not step_id:
            continue
        content = await value.read()
        if content:
            images[step_id] = content
    return images


def _collect_export_images(
    doc: dict[str, Any],
    recording_id: str,
    uploaded: dict[str, bytes],
) -> tuple[dict[str, bytes], dict[str, str]]:
    step_images: dict[str, bytes] = {}
    step_paths: dict[str, str] = {}
    storage_cache: dict[str, bytes] = {}

    for step in doc.get("steps", []):
        step_id = str(step.get("id", "")).strip()
        screenshot_id = step.get("screenshotId")
        if not step_id or not screenshot_id:
            continue

        if step_id in uploaded:
            step_images[step_id] = uploaded[step_id]
            step_paths[step_id] = export_step_image_path(step_id)
            continue

        if step_id in step_images:
            continue

        sid = str(screenshot_id)
        stored = storage_cache.get(sid)
        if stored is None:
            loaded = _load_step_image_from_storage(recording_id, sid)
            if loaded is not None:
                storage_cache[sid] = loaded
                stored = loaded
        if stored is not None:
            step_images[step_id] = stored
            relative = screenshot_relative_path(sid)
            if relative:
                step_paths[step_id] = relative

    return step_images, step_paths


@router.post("/recording/{recording_id}/export")
async def export_recording(
    recording_id: str,
    request: Request,
    session: Session = Depends(get_db_session),
) -> Response:
    recording = get_recording(session, recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    form = await request.form()
    doc_json = form.get("doc")
    export_format = form.get("format")
    if not isinstance(doc_json, str):
        raise HTTPException(status_code=422, detail="Поле doc обязательно")
    if export_format not in ("md", "html"):
        raise HTTPException(status_code=422, detail="format должен быть md или html")

    try:
        doc = json.loads(doc_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Некорректный JSON документа") from exc

    try:
        validate_generated_doc_shape(doc)
    except GenerationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    uploaded = await _parse_uploaded_step_images(form)
    images, paths = _collect_export_images(doc, recording_id, uploaded)

    if export_format == "md":
        archive = build_markdown_zip(doc, images, step_image_paths=paths)
        filename = f"{slugify_filename(str(doc.get('title', '')))}.zip"
        return Response(
            content=archive,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    inline_data: dict[str, str] = {}
    for step_id, image_bytes in images.items():
        if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
            mime = "image/png"
        else:
            mime = "image/jpeg"
        encoded = base64.b64encode(image_bytes).decode("ascii")
        inline_data[step_id] = f"data:{mime};base64,{encoded}"

    html_content = render_html(doc, inline_image_data=inline_data)
    filename = f"{slugify_filename(str(doc.get('title', '')))}.html"
    return Response(
        content=html_content,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
