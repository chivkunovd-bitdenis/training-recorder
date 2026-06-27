FROM node:20-alpine AS editor-build

WORKDIR /app/editor
COPY editor/package.json editor/package-lock.json ./
RUN npm ci
COPY editor/ ./
RUN npm run build

FROM python:3.11-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATABASE_URL=sqlite:////app/backend/data/training_recorder.db \
    STORAGE_ROOT=/app/backend/storage

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY shared/ shared/
COPY --from=editor-build /app/editor/dist editor/dist/

RUN mkdir -p backend/data backend/storage

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
