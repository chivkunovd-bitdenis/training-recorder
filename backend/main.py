from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import get_editor_dist_path
from backend.models import init_db
from backend.routes.doc import router as doc_router
from backend.routes.export import router as export_router
from backend.routes.process import router as process_router
from backend.routes.recording import router as recording_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(title="Training Recorder API", version="0.1.0", lifespan=lifespan)

# Редактор раздаётся с того же origin, поэтому CORS для него не нужен. Открываем
# доступ для расширения и на случай выноса редактора на отдельный адрес.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(process_router)
app.include_router(doc_router)
app.include_router(export_router)
app.include_router(recording_router)

_editor_dist = get_editor_dist_path()
_editor_assets = _editor_dist / "assets"
if _editor_assets.is_dir():
    app.mount(
        "/editor/assets",
        StaticFiles(directory=_editor_assets),
        name="editor-assets",
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/editor")
@app.get("/editor/")
@app.get("/editor/recording/{recording_id}")
def serve_editor(_recording_id: str | None = None) -> FileResponse:
    index_path = _editor_dist / "index.html"
    if not index_path.is_file():
        raise HTTPException(status_code=404, detail="Редактор не собран (нет editor/dist)")
    return FileResponse(index_path)
