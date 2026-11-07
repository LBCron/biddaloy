#!/usr/bin/env bash
# [8.5.4] Regenerates the visual baselines inside the pinned Playwright
# Docker image — the ONLY sanctioned way to write them (Linux font
# rendering is the baseline platform). Host node_modules are shadowed by
# named volumes — the container installs its own Linux binaries without
# touching the host's, and reruns reuse them instead of paying the full
# install again.
#
# Requires the compose stack up and a freshly seeded DB on the host:
#   docker compose up -d db redis
#   DB_DESTROY_CONFIRM=true yarn workspace @biddaloy/server db:reset
#   yarn workspace @biddaloy/server seed
set -euo pipefail

PLAYWRIGHT_VERSION="$(node -e "console.log(require('@playwright/test/package.json').version)")"
IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy"

echo "Updating visual baselines in ${IMAGE} (E2E_BROWSERS=${E2E_BROWSERS:-chromium})"

# Joins the compose network so `db`/`redis` resolve — the compose file
# publishes ports on 127.0.0.1 only, so host.docker.internal can't work.
docker run --rm \
  --network "${COMPOSE_NETWORK:-biddaloy_default}" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI=1 \
  -e E2E_BROWSERS="${E2E_BROWSERS:-chromium}" \
  -e SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:?export SEED_ADMIN_PASSWORD first}" \
  -e DATABASE_URL="${DOCKER_DATABASE_URL:-postgres://postgres:postgres@db:5432/betonboi}" \
  -e REDIS_URL="${DOCKER_REDIS_URL:-redis://redis:6379}" \
  -v "$(pwd)":/work -w /work \
  -v biddaloy-visual-node-modules:/work/node_modules \
  -v biddaloy-visual-server-nm:/work/server/node_modules \
  -v biddaloy-visual-ui-nm:/work/ui/node_modules \
  -v biddaloy-visual-client-admin-nm:/work/client-admin/node_modules \
  -v biddaloy-visual-shared-nm:/work/shared/node_modules \
  "${IMAGE}" \
  bash -c "yarn install --frozen-lockfile --ignore-engines \
    && yarn build:shared \
    && npx playwright test -c e2e/visual.config.ts --update-snapshots \
    && npx playwright test -c e2e/visual-stories.config.ts --update-snapshots"
