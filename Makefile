.PHONY: check typecheck test backend-check backend-install run smoke docker-build docker-smoke deploy-railway

check: typecheck test editor-build backend-check

typecheck:
	npm run typecheck

test:
	npm test

editor-build:
	@test -f editor/dist/index.html || (cd editor && npm ci && npm run build)

backend-install:
	python3 -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt

backend-check: backend-install
	ruff check backend tests/backend
	mypy backend tests/backend
	pytest tests/backend -q

run:
	uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

smoke: backend-install
	pytest tests/backend/test_mvp_smoke.py -q

docker-build:
	docker compose build

docker-smoke: docker-build
	docker compose up -d --wait
	curl -fsS http://127.0.0.1:8000/health
	docker compose down

deploy-railway:
	bash scripts/deploy_railway.sh
