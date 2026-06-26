# Training Recorder

Chrome-расширение + бэкенд: из записи обучения по веб-интерфейсу (голос + действия + скрины) получается редактируемая пользовательская инструкция.

## Структура

- `extension/` — Chrome MV3, запись вкладки и микрофона
- `backend/` — FastAPI, транскрипция, генерация, API редактора
- `editor/` — React SPA (сборка в `editor/dist`, раздаётся бэкендом)
- `shared/` — контракт `timeline.schema.json`
- `fixtures/` — мок-данные для тестов

## Локальная разработка

```bash
# Проверки
make check

# Бэкенд (из корня репозитория)
cp .env.example .env   # добавьте OPENAI_API_KEY
python3 -m pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Редактор (если меняли UI)
cd editor && npm install && npm run build
```

Расширение: Chrome → «Загрузить распакованное» → папка `extension/`.  
В popup укажите адрес бэкенда (`http://127.0.0.1:8000`).

## Docker (сервер)

```bash
cp .env.example .env
# Обязательно: OPENAI_API_KEY
# Опционально: BACKEND_PUBLIC_URL=https://your-domain.example

docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8000/health
```

Данные сохраняются в Docker volumes `api_data` (SQLite) и `api_storage` (артефакты записей).

### HTTPS через Caddy

```bash
docker compose --profile with-caddy up -d --build
```

Отредактируйте `Caddyfile` под свой домен.

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `OPENAI_API_KEY` | Whisper + LLM + vision fallback |
| `BACKEND_PUBLIC_URL` | Публичный URL для ссылок редактора |
| `GENERATE_MODEL` | Модель генерации (default `gpt-4o-mini`) |
| `VISION_BUDGET_PER_RECORDING` | Лимит vision-вызовов на запись (default `5`) |
| `DATABASE_URL` | SQLite (в Docker задан в compose) |
| `STORAGE_ROOT` | Папка артефактов записей |

## Smoke-тест MVP

Без живого OpenAI (имитация правок в редакторе и экспорта):

```bash
make smoke
```

Полный CI-гейт:

```bash
make check
```

## Типовой сценарий

1. Запись в расширении (вкладка + микрофон + согласие).
2. «Отправить и открыть редактор» → `POST /process` → вкладка `/editor/recording/{id}`.
3. Редактор вызывает `POST /recording/{id}/generate` (нужен API key).
4. Правки → «Сохранить» → экспорт MD / HTML / PDF.

## Обновление на сервере

```bash
git pull
docker compose up -d --build
docker compose ps
```

Секреты только в `.env` на сервере, не в git.
