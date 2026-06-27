# Railway deploy (Training Recorder)

Отдельный проект на Railway, **не связан** с Asya/WMS/VPS.

## Канонический процесс

```text
git push main  →  GitHub Actions (Release)  →  make check  →  railway up  →  /health
```

Workflow: `.github/workflows/release.yml`

## Один раз: Railway + GitHub

### 1. Проект на Railway

На **free tier** лимит — 2 проекта. Сервис `training-recorder` живёт в проекте **`quickloom-api`** (отдельно от Asya `screen-recorder-backend`).

Сервис: `training-recorder`  
Публичный URL: `https://training-recorder-production.up.railway.app`

### 2. API token

Railway → **Account Settings** → **Tokens** → Create.

**Важно:** workspace-scoped token работает через **GraphQL API**, но `railway` CLI может отвечать `Unauthorized` (известный баг Railway). CI использует `scripts/railway_graphql_deploy.sh`.

Для CLI локально: создайте token с **No workspace** (account-scoped).

### 3. GitHub (repo `training-recorder`)

**Secret** (Settings → Secrets → Actions):

| Имя | Значение |
|-----|----------|
| `RAILWAY_API_TOKEN` | account token из шага 2 |
| `OPENAI_API_KEY` | ключ OpenAI |

**Variables** (Settings → Variables → Actions):

| Имя | Значение |
|-----|----------|
| `RAILWAY_PROJECT_ID` | `da429808-c8bb-4198-bc46-25646f97e506` (проект quickloom-api) |
| `RAILWAY_ENVIRONMENT_ID` | `c088d831-ecd6-46ac-9a73-c2193fb07664` |
| `RAILWAY_SERVICE_ID` | `fa9e0bcb-3cf7-4549-a035-d9abcf283815` |
| `RAILWAY_SERVICE` | `training-recorder` |
| `PROD_HEALTH_URL` | `https://training-recorder-production.up.railway.app` |

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
