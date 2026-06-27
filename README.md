# Training Recorder

Chrome-расширение + бэкенд: из записи обучения по веб-интерфейсу (голос + действия + скрины) получается редактируемая пользовательская инструкция.

## Структура

- `extension/` — Chrome MV3, запись вкладки и микрофона
- `backend/` — FastAPI, транскрипция, генерация, API редактора
- `editor/` — React SPA (сборка в `editor/dist`, раздаётся бэкендом)
- `shared/` — контракт `timeline.schema.json`
- `fixtures/` — мок-данные для тестов

## Расширение Chrome (у себя в браузере)

**Папка для загрузки:** `extension/` в этом репозитории.

На твоём компьютере:

```text
/Users/deniscivkunov/Desktop/Плагин для автодокументации/extension
```

1. Chrome → `chrome://extensions/` → **Режим разработчика** → **Загрузить распакованное**
2. Выбрать папку **`extension`** (не корень проекта, не `backend/`)
3. В popup адрес сервера: `https://training-recorder-production.up.railway.app`

Подробнее: **`docs/CHROME_EXTENSION.md`**

## Локальная разработка (бэкенд на машине)

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

В popup расширения для локального бэкенда укажи `http://127.0.0.1:8000`.

## Docker (локально / свой сервер)

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8000/health
```

## Прод: Railway (рекомендуется)

Отдельный проект на Railway — см. **`docs/RAILWAY_DEPLOY.md`**.

Кратко: GitHub repo `training-recorder` → push `main` → Railway.

Расширение ставится локально из папки `extension/` — см. **`docs/CHROME_EXTENSION.md`**.

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
