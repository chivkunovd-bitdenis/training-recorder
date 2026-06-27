FROM node:20-alpine AS editor-build

WORKDIR /app
COPY editor/package.json editor/package-lock.json ./editor/
RUN cd editor && npm ci
COPY editor/ ./editor/
COPY shared/ ./shared/
WORKDIR /app/editor
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
COPY scripts/railway_start.sh scripts/railway_start.sh
COPY --from=editor-build /app/editor/dist editor/dist/

RUN mkdir -p backend/data backend/storage && chmod +x scripts/railway_start.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

CMD ["/bin/sh", "./scripts/railway_start.sh"]
