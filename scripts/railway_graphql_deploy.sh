#!/usr/bin/env bash
# Деплой через Railway GraphQL (workspace token не работает в railway CLI — баг Railway).
set -euo pipefail

TOKEN="${RAILWAY_API_TOKEN:?RAILWAY_API_TOKEN required}"
PROJECT_ID="${RAILWAY_PROJECT_ID:?RAILWAY_PROJECT_ID required}"
ENVIRONMENT_ID="${RAILWAY_ENVIRONMENT_ID:?RAILWAY_ENVIRONMENT_ID required}"
SERVICE_ID="${RAILWAY_SERVICE_ID:?RAILWAY_SERVICE_ID required}"

gql() {
  local query="$1"
  curl -sfSL -X POST https://backboard.railway.com/graphql/v2 \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "${query}"
}

echo "==> railway GraphQL deploy"
result="$(gql "{\"query\":\"mutation { serviceInstanceDeployV2(serviceId: \\\"${SERVICE_ID}\\\", environmentId: \\\"${ENVIRONMENT_ID}\\\") }\"}")"
echo "${result}"
deploy_id="$(echo "${result}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['serviceInstanceDeployV2'])")"
echo "deploymentId=${deploy_id}"
