# Railway deploy (Training Recorder)

Отдельный проект на Railway, **не связан** с Asya/WMS/VPS.

## Канонический процесс

```text
git push main  →  GitHub Actions (Release)  →  make check  →  railway up  →  /health
```

Workflow: `.github/workflows/release.yml`

## Один раз: Railway + GitHub

### 1. Новый проект на Railway

Railway → **New Project** → **Empty Project** → имя, например `training-recorder`.

В проекте: **New Service** → **Empty Service** → имя `training-recorder`.

Включите **Public Networking** → сгенерируйте домен (например `training-recorder-production.up.railway.app`).

Опционально: **Volume** → mount `/data` (SQLite + файлы записей переживают redeploy).

### 2. Account token

Railway → **Account Settings** → **Tokens** → Create (account token, не OAuth из `railway login`).

### 3. GitHub (repo `training-recorder`)

**Secret** (Settings → Secrets → Actions):

| Имя | Значение |
|-----|----------|
| `RAILWAY_API_TOKEN` | account token из шага 2 |
| `OPENAI_API_KEY` | ключ OpenAI |

**Variables** (Settings → Variables → Actions):

| Имя | Значение |
|-----|----------|
| `RAILWAY_PROJECT_ID` | ID проекта из Railway (Settings → General) |
| `RAILWAY_SERVICE` | `training-recorder` |
| `RAILWAY_ENVIRONMENT` | `production` |
| `PROD_HEALTH_URL` | `https://…up.railway.app` (без `/health`) |

### 4. Первый деплой

Push в `main` или **Actions → Release → Run workflow**.

После деплоя:

```bash
curl -sS "$PROD_HEALTH_URL/health"
# {"status":"ok"}
```

## Локальный деплой (если CI недоступен)

```bash
cp .env.railway.example .env.railway
# заполнить RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, PROD_HEALTH_URL
make deploy-railway
```

## Переменные на Railway (сервис)

CI выставляет автоматически; вручную в Railway → Variables:

| Переменная | Значение |
|------------|----------|
| `OPENAI_API_KEY` | секрет |
| `DATABASE_URL` | `sqlite:////data/training_recorder.db` |
| `STORAGE_ROOT` | `/data/storage` |
| `BACKEND_PUBLIC_URL` | публичный URL сервиса |
| `GENERATE_MODEL` | `gpt-4o` (опционально) |

## Расширение Chrome

В popup укажите `BACKEND_PUBLIC_URL` (тот же, что `PROD_HEALTH_URL`).

## Обновление

Каждый push в `main` после зелёного `check` → автодеплой.

Не включайте второй autodeploy из Railway UI на тот же branch — только GitHub Actions.

## VPS

Training Recorder **не** деплоится на `194.87.96.144`. Если поднимали там раньше — `docker compose down` в `/opt/training-recorder`.
