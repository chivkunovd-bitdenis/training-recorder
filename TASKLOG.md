# TASKLOG

## TASK-19 — 2026-06-27 — Deploy на VPS Цюрих (194.87.96.144:8012)

**Что сделано:**
- GitHub: `chivkunovd-bitdenis/training-recorder` (private), push `main` `17bbe8a`
- `Dockerfile` — multi-stage (сборка editor внутри Docker + `shared/` для annotation-utils)
- `scripts/deploy/prod-update.sh` — git pull + docker compose rebuild
- Сервер `/opt/training-recorder`: `.env` (OPENAI_API_KEY, BACKEND_PUBLIC_URL, API_PORT=8012), `docker compose up -d --build`

**Что НЕ менялось:** расширение Chrome (ставится локально, адрес бэкенда в popup); HTTPS/домен (пока HTTP :8012).

**Проверка:**
- `curl http://194.87.96.144:8012/health` → `{"status":"ok"}`
- `GET /editor/recording/test` → HTTP 200
- `docker compose ps` — api Up, порт 8012

---

## TASK-18 — 2026-06-26 — Release: Docker + smoke MVP

**Что сделано:**
- `Dockerfile`, `docker-compose.yml` (volumes для БД и storage), `Caddyfile` (profile `with-caddy`)
- `.dockerignore`, `README.md` — локальный запуск и деплой `git pull` + `docker compose up -d --build`
- `tests/backend/test_mvp_smoke.py` — сквозной путь: process → doc → editor → export → delete (без OpenAI)
- `Makefile`: `run`, `smoke`, `docker-build`, `docker-smoke`
- `.env.example` — DATABASE_URL, STORAGE_ROOT, BACKEND_PUBLIC_URL

**Что НЕ менялось:** git init / push; `docker-smoke` не прогнан — Docker daemon недоступен в среде агента.

**Проверка:** `make check` — 42 npm + 51 pytest (2 skipped), exit 0; `make smoke` входит в backend-check.

**Следующий шаг владельца:** `git init` + commit; на сервере `.env` + `docker compose up -d --build`; живая запись 3–5 мин с `OPENAI_API_KEY`.

## TASK-17 — 2026-06-26 — T4.1 Vision fallback

**Что сделано:**
- `backend/services/vision.py` — триггеры (пустой DOM text/role/label, скрин `confidence=low`), `describe_with_vision`, `enrich_merged_with_vision` с бюджетом вызовов
- `backend/prompts/vision_describe.md` — промпт описания элемента/экрана
- `backend/config.py` — `VISION_MODEL`, `VISION_BUDGET_PER_RECORDING` (default 5)
- `backend/services/pipeline.py` — vision между merge и LLM (ошибка vision не роняет pipeline)
- `backend/services/generate.py` — `visionEventDescriptions` / `visionScreenshotDescription` в контексте LLM
- `backend/prompts/generate_doc.md` — правило использовать vision fallback
- `tests/backend/test_vision_t41.py` — 9 тестов

**Что НЕ менялось:** vision не вызывается из редактора/экспорта отдельно; только в pipeline генерации.

**Проверка:** `make check` — 42 npm + 49 pytest (2 skipped quota), exit 0.

**MVP по PLAN.md закрыт** (E0–E4).

## TASK-16 — 2026-06-26 — T3.3 Экспорт Markdown / HTML / PDF

**Что сделано:**
- `backend/services/render.py` — пути скринов по шагам, `build_markdown_zip()`, inline base64 для HTML, ASCII-safe имена файлов
- `backend/routes/export.py` — `POST /recording/{id}/export` (multipart: doc + аннотированные PNG по шагам)
- `editor/src/export.ts` — bake скринов с аннотациями, скачивание ZIP (MD), HTML, печать в PDF
- `editor/src/App.tsx` — кнопки «Скачать Markdown», «Скачать HTML», «Печать в PDF»
- `tests/backend/test_export_t33.py` — 6 тестов
- `editor/dist` пересобран

**Что НЕ менялось:** T4.1 vision-fallback; нативный PDF/DOCX.

**Проверка:** `make check` — 42 npm + 40 pytest (2 skipped quota), exit 0; `npm run build` в editor.

**Следующая задача:** **T4.1** — vision только как fallback (опционально).

## TASK-15 — 2026-06-26 — T3.2 Аннотации скриншотов + OPENAI_API_KEY в .env

**Что сделано:**
- `.env` / `.env.example` + `python-dotenv` в `backend/config.py` (`.env` в `.gitignore`)
- `shared/annotation-utils.mjs` — bbox из событий, масштаб, отрисовка на canvas, bake PNG
- `shared/timeline.schema.json` — `ScreenshotAnnotation` у `Step`
- `GET /recording/{id}/timeline` — события и размеры скринов для редактора
- `editor/src/ScreenshotAnnotator.tsx` — рамка, стрелка, номер шага, drag, toggle, скачать PNG
- `tests/annotation-t32.test.mjs` — 4 теста на моке «Создать клиента»
- integration-тесты OpenAI skip при `insufficient_quota` (429)

**Что НЕ менялось:** T3.3 полный экспорт MD/HTML/PDF с впечёнными скринами (есть кнопка PNG на шаг).

**Проверка:** `make check` — 42 npm + 34 pytest (2 skipped quota), exit 0.

**Следующая задача:** **T3.3** — экспорт Markdown / HTML / PDF.

## TASK-14 — 2026-06-26 — T3.1 Экран-редактор

**Что сделано:**
- `editor/` — React+Vite SPA (`editor/dist` собран и закоммичен)
- `backend/routes/doc.py` — `GET ...?format=json`, `PUT /recording/{id}/doc`
- `backend/routes/recording.py` — `POST /recording/{id}/generate`, `GET .../screenshots/{file}`
- `backend/services/pipeline.py` — сквозной pipeline: транскрипция → merge → LLM → screenshot match
- `backend/main.py` — раздача `/editor/` и статики `/editor/assets`
- `extension/lib/upload-recording.js` + popup: «Отправить и открыть редактор», поле адреса сервера, `chrome.tabs.create`
- `tests/backend/test_editor_t31.py`, `tests/upload-t31.test.mjs`

**Что НЕ менялось:** T3.2 аннотации скринов, T3.3 экспорт; авто-генерация при `POST /process` (редактор вызывает `/generate` при отсутствии doc).

**Проверка:** `make check` — 38 npm + 33 pytest (2 skipped), exit 0.

**Следующая задача:** **T3.2** — аннотации скриншотов (canvas-оверлей).

## TASK-13 — 2026-06-26 — T2.6 Рендер Markdown + HTML

**Что сделано:**
- `backend/services/render.py` — `render_markdown()`, `render_html()` (структура по ТЗ, скрины `screenshots/{id}.jpg`, print CSS)
- `backend/routes/doc.py` — `GET /recording/{id}/doc?format=md|html`
- `backend/storage.py` — `save_generated_doc()`, `load_generated_doc()`
- `backend/main.py` — подключён doc router
- `tests/backend/test_render_t26.py` — 5 тестов (unit + API)

**Что НЕ менялось:** сквозной async pipeline после `POST /process` (генерация doc вручную через `generated_doc.json`); редактор T3.x.

**Проверка:** `make check` — 34 npm + 27 pytest (2 skipped), exit 0.

**Эпик 2 (бэкенд AI) по коду закрыт.** Следующая задача: **T3.1** — экран-редактор.

## TASK-12 — 2026-06-26 — T2.5 Привязка шаг ↔ скрин (уточнение)

**Что сделано:**
- `backend/services/screenshot_match.py` — `refine_generated_doc_screenshots()`: скрин по `eventId` (high > low), fallback по ближайшему `ts` + `needsReview`; `screenshotCandidates[]`
- `shared/timeline.schema.json`, `shared/timeline.types.ts` — опциональное поле `screenshotCandidates` у `Step`
- `tests/backend/test_screenshot_match_t25.py` — 5 тестов на моке «создание клиента»

**Что НЕ менялось:** render (T2.6), HTTP pipeline; `generate.py` не вызывает refine автоматически.

**Проверка:** `make check` — 34 npm + 21 pytest (2 skipped), exit 0.

**Следующая задача:** **T2.6** — рендер Markdown + HTML (`backend/services/render.py`).

## TASK-11 — 2026-06-26 — T2.4 LLM-генерация документа

**Что сделано:**
- `backend/prompts/generate_doc.md` — системный промпт: логические шаги, очистка речи, привязка скринов, запрет выдуманных действий
- `backend/services/generate.py` — `generate_document(merged)` через OpenAI `json_schema` (strict `GeneratedDoc`); валидация схемы + проверка `eventIds`/`screenshotId` по таймлайну
- `fixtures/generated_doc.mock.json` — эталон для сценария «создание клиента» (4 шага)
- `backend/config.py` — `GENERATE_MODEL` (default `gpt-4o-mini`), `GENERATE_PROMPT_PATH`
- `tests/backend/test_generate_t24.py` — 5 тестов + 1 integration (skip без `OPENAI_API_KEY`)

**Что НЕ менялось:** T2.5 screenshot_match, T2.6 render, HTTP pipeline.

**Проверка:** `make check` — 34 npm + 16 pytest (2 skipped), exit 0.

**Следующая задача:** **T2.5** — уточнение привязки шаг ↔ скрин (`backend/services/screenshot_match.py`).

## TASK-10 — 2026-06-26 — T2.3 Сборка единого таймлайна + первичная группировка

**Что сделано:**
- `backend/services/merge.py` — `merge_timeline()`: объединение речи/событий/скринов в `entries[]`; якоря-реплики; предварительные шаги `steps[]` с привязкой скринов (high > low)
- `tests/backend/test_merge_t23.py` — 5 тестов на `fixtures/timeline.mock.json`

**Что НЕ менялось:** LLM-генерация (T2.4); merge не встроен в HTTP pipeline.

**Проверка:** `make check` — 34 npm + 12 pytest (1 skipped), exit 0.

**Следующая задача:** **T2.4** — LLM-генерация документа (`backend/services/generate.py`).

## TASK-9 — 2026-06-26 — T2.2 Транскрипция Whisper (verbose_json)

**Что сделано:**
- `backend/services/transcription.py` — Whisper `whisper-1`, `verbose_json`, гранулярности word+segment; маппинг в `TranscriptSegment[]` (мс от t0)
- `backend/config.py` — `get_openai_api_key()`
- `fixtures/mic.sample.webm` — ~18 с тестовой речи (TTS macOS)
- `tests/backend/test_transcription_t22.py` — 4 unit-теста + 1 integration (skip без `OPENAI_API_KEY`)
- `backend/requirements.txt` — `openai>=1.55.0`

**Что НЕ менялось:** эндпойнты, merge/LLM (T2.3+); транскрипция пока не встроена в pipeline `POST /process`.

**Проверка:** `make backend-check` — 7 passed, 1 skipped; ruff + mypy зелёные.

**Следующая задача:** **T2.3** — сборка единого таймлайна (`backend/services/merge.py`).

## TASK-8 — 2026-06-26 — T2.1 Эндпойнт приёма артефактов (бэкенд)

**Что сделано:**
- `backend/` — FastAPI-приложение: `POST /process` (multipart), `DELETE /recording/{id}`, `GET /health`
- `backend/storage.py` — валидация `timeline.json` по `shared/timeline.schema.json`, сохранение в `storage/{recordingId}/`
- `backend/models.py` — SQLite таблицы `recordings`, `jobs` (SQLAlchemy)
- `backend/routes/process.py` — приём `mic`, `timeline`, `screenshots[]` (опционально `video`)
- `tests/backend/test_process_t21.py` — 3 теста: успешный upload, отклонение невалидного timeline (422), DELETE
- `Makefile` — цель `backend-check`; `make check` включает backend
- `pyproject.toml`, `.gitignore` — ruff/mypy/pytest для Python

**Что НЕ менялось:** расширение (upload на сервер — позже); Whisper/merge/LLM (T2.2+).

**Проверка:** `make check` — 34 npm + 3 pytest, exit 0; ruff + mypy зелёные.

**Следующая задача:** **T2.2** — транскрипция Whisper (`backend/services/transcription.py`).

## TASK-7 — 2026-06-26 — T1.5 Экран-предупреждение + удаление артефактов

**Что сделано:**
- `popup/popup.html` — экран согласия: что записывается, Whisper, чекбокс «Я понимаю и согласен»
- `popup/popup.js` — без согласия «Запись» заблокирована; после стопа — кнопка удаления
- `lib/recording-artifacts.js` — очистка `lastRecording`, DELETE `/recording/{id}` если `uploaded=true`
- `service-worker.js` — `DELETE_RECORDING`, `hasLastRecording` в `RECORDING_STATE`, `uploaded:false` при сохранении
- `tests/popup-t15.test.mjs` — 6 тестов согласия и удаления

**Что НЕ менялось:** бэкенд (DELETE сработает после T2.1 + upload flow).

**Проверка:** `make check` — 34 теста, exit 0.

**Ручная приёмка T1.5:** без галочки «Запись» неактивна → после записи кнопка «Удалить…» → статус «Локальная запись удалена», повторное удаление — «Нечего удалять».

**Эпик 1 завершён.** Следующая задача: **T2.1** — эндпойнт приёма артефактов (бэкенд).

## TASK-6 — 2026-06-26 — T1.4 Детектор стабилизации + отбор кадров

**Что сделано:**
- `content/stabilizer.js` — FSM: WAITING → CAPTURED / SUPERSEDED / TIMED_OUT; 4 условия стабильности
- `content/net-hook.js` — monkey-patch fetch/XHR в контексте страницы, счётчик активных запросов
- `lib/frame-capture.js` + `lib/stabilizer-config.js` — буфер кадров, triplet ±120мс, JPEG из видеопотока
- `offscreen.js` — FrameCapture на video stream, `OFFSCREEN_CAPTURE_FRAMES`
- `content.js` — significant actions → stabilizer → CAPTURE_FRAMES → screenshots в timeline
- `service-worker.js`, `popup.js` — маршрутизация кадров, скачивание `*.jpg` + `timeline.json` со screenshots
- `tests/stabilizer-t14.test.mjs` — supersede, quiet capture, timeout, loaders, frame buffer

**Что НЕ менялось:** экран согласия (T1.5), бэкенд.

**Проверка:** `make check` — 28 тестов, exit 0.

**Ручная приёмка T1.4:** обновить расширение → записать на test-page → клики по кнопкам → в `timeline.json` есть `screenshots[]` с `confidence`, `eventId`, `candidates[]`; скачиваются jpg.

**Следующая задача:** T1.5 — экран-предупреждение + удаление артефактов.

## TASK-5 — 2026-06-26 — T1.3 Маскирование на клиенте (privacy gate)

**Что сделано:**
- `extension/content/masking.js` — password/PII/data-sensitive маскирование, лимит value 200 симв
- Интеграция в `dom-context.js` — `buildElementContext` и `createRecEvent` применяют masking
- `service-worker.js` — инъекция `masking.js` перед dom-context
- `fixtures/test-page.html` — поля password, email, tel, data-sensitive для ручной проверки
- `tests/content-t13.test.mjs` — 6 юнит-тестов маскирования и timeline без PII

**Что НЕ менялось:** стабилизация скринов (T1.4), экран согласия (T1.5).

**Проверка:** `make check` — 22 теста, exit 0.

**Ручная приёмка T1.3:** записать форму на test-page → в `timeline.json` нет реальных password/email/phone; у чувствительных полей `masked=true`, value=`••••`.

**Следующая задача:** T1.4 — детектор стабилизации + отбор кадров (ядро продукта).

## TASK-4 — 2026-06-26 — T1.2 Content script: сбор событий + DOM-контекст

**Что сделано:**
- `extension/content/dom-context.js` — ElementContext, cssPath, label, nearbyText, bbox, createRecEvent
- `extension/content/content.js` — слушатели click/input/submit/focus/navigation/modal/menu_select, буфер RecEvent
- `extension/content/bridge.js` — константы сообщений для content script
- `service-worker.js` — инъекция content script при старте, сбор events при стопе, `timeline` в ответе
- `offscreen.js` — возвращает `t0` при старте (синхронизация часов)
- `popup.js` — скачивает `timeline.json` (meta + events + screenshots:[])
- `fixtures/test-page.html` — форма + select + модалка для ручной проверки
- `tests/content-t12.test.mjs` — jsdom-тесты RecEvent по схеме

**Что НЕ менялось:** маскирование (T1.3), стабилизация скринов (T1.4).

**Проверка:** `make check` — 16 тестов, exit 0.

**Ручная приёмка T1.2:** открыть `fixtures/test-page.html` в Chrome → записать → в `timeline.json` есть click/input/submit/menu_select/modal_open с target.text/label/bbox.

**Следующая задача:** T1.3 — маскирование на клиенте (privacy gate).

## TASK-3 — 2026-06-26 — T1.1 Запись вкладки + отдельная дорожка микрофона

**Что сделано:**
- `offscreen.js` — два независимых `MediaRecorder`: видео вкладки (`getDisplayMedia`, `audio:false`) и микрофон (`getUserMedia`, `audio:true`)
- Общий `t0` до запроса потоков; в meta — `videoStartOffsetMs`, `micStartOffsetMs`, `videoDurationMs`, `micDurationMs`
- Контракт T0.1 расширен: новые поля в `RecordingMeta` (schema + types + mock)
- `popup.js` — скачивает три артефакта: `video.webm`, `mic.webm`, `meta.json`
- `extension/lib/duration.js`, `blob-utils.js`; тесты `extension-t11.test.mjs`

**Что НЕ менялось:** content scripts, маскирование, стабилизация скринов.

**Проверка:** `make check` — 10 тестов, exit 0.

**Ручная приёмка T1.1:** перезагрузить расширение → Запись → разрешить вкладку и микрофон → Стоп → три файла; в `mic.webm` только голос; в `meta.json` `|videoDurationMs - micDurationMs| ≤ 300`.

**Следующая задача:** T1.2 — content script: сбор событий + DOM-контекст.

## TASK-2 — 2026-06-26 — T0.2 Каркас MV3 + offscreen-запись

**Что сделано:**
- `extension/manifest.json` — MV3, permissions: offscreen, activeTab, scripting, storage, tabs
- `extension/service-worker.js` — создаёт/закрывает offscreen document, start/stop, хранит session state
- `extension/offscreen.html` + `offscreen.js` — MediaRecorder + getDisplayMedia(preferCurrentTab), t0 в RecordingMeta
- `extension/popup/` — кнопки «Запись» / «Стоп», скачивание `video.webm` + `meta.json`
- `extension/lib/recording-meta.js`, `messages.js` — общая логика meta и протокол сообщений
- `tests/extension-t02.test.mjs` — manifest, файлы, RecordingMeta + t0 по схеме T0.1

**Что НЕ менялось:** отдельная дорожка микрофона (T1.1), content scripts, бэкенд.

**Проверка:** `make check` — 7 тестов, exit 0.

**Ручная приёмка T0.2:** Chrome → Расширения → «Загрузить распакованное» → папка `extension/` → открыть любую вкладку → popup «Запись» → подтвердить захват вкладки → «Стоп» → скачиваются `video.webm` (>0 байт) и `meta.json` с полем `t0`.

**Следующая задача:** T1.1 — запись вкладки + отдельная дорожка микрофона.

## TASK-1 — 2026-06-26 — T0.1 Единый контракт таймлайна

**Что сделано:**
- `shared/timeline.schema.json` — JSON Schema (draft 2020-12) для `Timeline`, событий, скринов, транскрипта, `GeneratedDoc`
- `shared/timeline.types.ts` — TypeScript-типы по контракту из PLAN.md
- `fixtures/timeline.mock.json` — мок сценария «создание клиента»
- Тесты: валидация мока по схеме (Ajv2020), отклонение невалидного JSON, совместимость с TS-типами
- `make check` = `tsc --noEmit` + `npm test`

**Что НЕ менялось:** расширение, бэкенд, редактор — ещё не созданы.

**Проверка:** `make check` — 3 теста, exit 0.

**Следующая задача:** T0.2 — каркас MV3 + offscreen-запись.
