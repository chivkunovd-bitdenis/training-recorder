#!/usr/bin/env python3
"""Сквозной live-тест: Whisper → merge → vision → LLM → doc (нужен OPENAI_API_KEY в .env)."""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from collections.abc import Generator
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

work_dir = Path(tempfile.mkdtemp(prefix="live-e2e-"))
os.environ["DATABASE_URL"] = f"sqlite:///{work_dir / 'test.db'}"
os.environ["STORAGE_ROOT"] = str(work_dir / "storage")
(work_dir / "storage").mkdir(parents=True, exist_ok=True)

from dotenv import load_dotenv

load_dotenv(PROJECT_ROOT / ".env")

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from backend.config import get_openai_api_key, get_storage_root
from backend.models import Base, configure_database, get_db_session, get_engine


def main() -> int:
    if not get_openai_api_key():
        print("FAIL: OPENAI_API_KEY не задан в .env")
        return 1

    fixtures = PROJECT_ROOT / "fixtures"
    timeline_bytes = (fixtures / "timeline.mock.json").read_bytes()
    mic_bytes = (fixtures / "mic.sample.webm").read_bytes()
    screenshot_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 100

    work_dir = Path(os.environ["STORAGE_ROOT"]).parent
    db_path = work_dir / "test.db"
    storage_path = work_dir / "storage"

    configure_database(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=get_engine())
    session_local = sessionmaker(bind=get_engine(), autoflush=False, autocommit=False)

    def override_get_db() -> Generator[Session, None, None]:
        session = session_local()
        try:
            yield session
        finally:
            session.close()

    from backend.main import app

    app.dependency_overrides[get_db_session] = override_get_db

    print("=== Live E2E: Training Recorder MVP ===\n")

    with TestClient(app) as client:
        print("1. POST /process …")
        create = client.post(
            "/process",
            files={
                "mic": ("mic.webm", mic_bytes, "audio/webm"),
                "timeline": ("timeline.json", timeline_bytes, "application/json"),
                "screenshots": ("scr-001.jpg", screenshot_bytes, "image/jpeg"),
            },
        )
        if create.status_code != 200:
            print(f"FAIL process: {create.status_code} {create.text}")
            return 1
        recording_id = create.json()["recordingId"]
        print(f"   OK recordingId={recording_id}")

        root = get_storage_root()
        shots_dir = root / recording_id / "screenshots"
        for sid in ("scr-002", "scr-003", "scr-004"):
            (shots_dir / f"{sid}.jpg").write_bytes(screenshot_bytes)

        print("2. POST /recording/{id}/generate (Whisper + LLM + vision) …")
        gen = client.post(f"/recording/{recording_id}/generate")
        if gen.status_code != 200:
            print(f"FAIL generate: {gen.status_code} {gen.text}")
            return 1
        doc = gen.json()
        print(f"   OK title={doc['title']!r}")
        print(f"   steps={len(doc['steps'])}, purpose len={len(doc['purpose'])}")

        print("3. GET doc markdown …")
        md = client.get(f"/recording/{recording_id}/doc", params={"format": "md"})
        if md.status_code != 200:
            print(f"FAIL md: {md.status_code}")
            return 1
        print(f"   OK markdown {len(md.text)} chars, starts with: {md.text[:80]!r}…")

        print("4. GET editor …")
        editor = client.get(f"/editor/recording/{recording_id}")
        if editor.status_code != 200:
            print(f"FAIL editor: {editor.status_code}")
            return 1
        print(f"   OK editor HTML {len(editor.text)} chars")

        meta_path = root / recording_id / "timeline.json"
        if meta_path.is_file():
            timeline = json.loads(meta_path.read_text(encoding="utf-8"))
            transcript = timeline.get("transcript", [])
            if transcript:
                sample = transcript[0].get("text", "")[:80]
                print(f"5. Transcript sample: {sample!r}…")

        vision_used = timeline.get("meta", {}).get("visionCallsUsed") if meta_path.is_file() else None
        if vision_used is not None:
            print(f"6. Vision calls used: {vision_used}")

        print("\n=== LIVE E2E PASSED ===")
        print(json.dumps({"recordingId": recording_id, "title": doc["title"], "steps": len(doc["steps"])}, ensure_ascii=False))

    app.dependency_overrides.clear()
    shutil.rmtree(work_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
