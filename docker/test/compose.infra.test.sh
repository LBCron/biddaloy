#!/usr/bin/env bash
# [75.29] Compose / image-pin checks. CI-only (the `infra` job runs every
# *.infra.test.sh). Static checks first; the backup-image checks build and run
# one small container, so they need a Docker daemon.
set -euo pipefail
cd "$(dirname "$0")/../.."

fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "ok: $1"; }

export APP_VERSION=test POSTGRES_USER=x POSTGRES_PASSWORD=x POSTGRES_DB=x JWT_SECRET=x \
  S3_ACCESS_KEY_ID=x S3_SECRET_ACCESS_KEY=x PG_TLS_DIR=./.pgtls DEMO_PASSWORD=x EDGE_DIR=./.edge \
  LANDING_VERSION=test EDGE_MODE=tunnel OPS_DIR=./.ops APP_DOMAIN=app.example.test ROOT_DOMAIN=example.test \
  BACKUP_AGE_PUBLIC_KEY=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq

# Dev compose (db, redis, seaweedfs, mailpit) must stay valid.
docker compose config -q && pass "dev compose config is valid" || fail "dev compose config is invalid"

# [79.0] The stack is one file started once per env; every env must merge.
STACK=(-f deploy/stack.yml)
ENV_NAME=prod COMPOSE_PROFILES=replica,backup docker compose "${STACK[@]}" config -q \
  && pass "stack (prod) config is valid" || fail "stack (prod) config is invalid"
ENV_NAME=staging docker compose "${STACK[@]}" config -q \
  && pass "stack (staging) config is valid" || fail "stack (staging) config is invalid"
ENV_NAME=demo DEMO_MODE=true docker compose "${STACK[@]}" config -q \
  && pass "stack (demo) config is valid" || fail "stack (demo) config is invalid"
ENV_NAME=local docker compose "${STACK[@]}" -f docker-compose.build.yml config -q \
  && pass "build overlay config is valid" || fail "build overlay config is invalid"
docker compose -f deploy/edge.yml config -q \
  && pass "edge (tunnel) config is valid" || fail "edge (tunnel) config is invalid"
EDGE_MODE=direct docker compose -f deploy/edge.yml -f deploy/edge.direct.yml config -q \
  && pass "edge (direct) config is valid" || fail "edge (direct) config is invalid"
docker compose -f deploy/ops.yml config -q \
  && pass "ops config is valid" || fail "ops config is invalid"

# Only app / app2 and the test inbox (mailpit, Epic 87) join the edge network; no host ports on
# any stack service; no docker socket in the stack (the demo rebuild runs without one, D11).
stack_json="$(ENV_NAME=prod docker compose "${STACK[@]}" --profile '*' config --format json)"
on_edge="$(jq -r '.services | to_entries[] | select(.value.networks | has("edge")) | .key' <<<"$stack_json" | sort | tr '\n' ' ')"
[ "$on_edge" = "app app2 mailpit site " ] && pass "only app, app2, mailpit and site join the edge network" || fail "edge network members: $on_edge"
# The app must reach its own stack's mailpit by a per-stack name (Epic 87 follow-up): the bare
# `mailpit` alias sits on the shared edge network for every stack, and demo's mail once landed in
# staging's inbox. The alias must exist on the stack network too, so the URL resolves on either.
sink_url="$(jq -r '.services.app.environment.MESSAGE_SINK_SMTP_URL' <<<"$stack_json")"
[ "$sink_url" = "smtp://prod-mailpit:1025" ] && pass "app sink URL names this stack's mailpit" || fail "app MESSAGE_SINK_SMTP_URL: $sink_url"
jq -e '.services.mailpit.networks | (.default.aliases // []) == ["prod-mailpit"] and (.edge.aliases // []) == ["prod-mailpit"]' <<<"$stack_json" >/dev/null \
  && pass "mailpit carries the per-stack alias on both networks" || fail "mailpit aliases: $(jq -c '.services.mailpit.networks' <<<"$stack_json")"
ports="$(jq -r '.services | to_entries[] | select(.value.ports) | .key' <<<"$stack_json")"
[ -z "$ports" ] && pass "stack publishes no host ports" || fail "stack services with host ports: $ports"
jq -e '[.services[].volumes[]? | select(.source | tostring | test("docker\\.sock"))] | length == 0' <<<"$stack_json" >/dev/null \
  && pass "stack mounts no docker socket" || fail "stack mounts a docker socket"
jq -e '[.services | to_entries[] | select(.value.container_name)] | length == 0' <<<"$stack_json" >/dev/null \
  && pass "stack sets no container_name" || fail "stack sets container_name"

# Every third-party image in compose is pinned by digest. First-party GHCR
# images must carry exactly the APP_VERSION tag (the commit SHA in prod), or
# LANDING_VERSION for the landing site, so a mutable `:main` / `:latest` fails here too (Rule 21).
unpinned="$( { ENV_NAME=prod docker compose "${STACK[@]}" --profile '*' config --images
  docker compose -f deploy/edge.yml --profile '*' config --images
  docker compose -f deploy/edge.yml -f deploy/edge.direct.yml --profile '*' config --images
  docker compose -f deploy/ops.yml config --images
  docker compose config --images; } | sort -u \
  | grep -v -E "^ghcr\.io/tareq89/biddaloy-[a-z-]+:(${APP_VERSION}|${LANDING_VERSION})\$" | grep -v -E '@sha256:[0-9a-f]{64}$' || true)"
[ -z "$unpinned" ] || fail "compose images not digest-pinned: $unpinned"
pass "compose images are digest-pinned"

for df in Dockerfile scripts/backup/Dockerfile; do
  # Skip only FROMs that name an earlier build stage (FROM base AS deps), so a
  # real image with an alias (FROM alpine AS tools) is still checked.
  bad="$(awk '$1=="FROM" { if (!($2 in stage) && $2 !~ /@sha256:[0-9a-f]{64}$/) print; if ($3=="AS") stage[$4]=1 }' "$df")"
  [ -z "$bad" ] || fail "$df has an unpinned FROM: $bad"
done
pass "app and backup Dockerfile FROMs are digest-pinned"

docker build -q -t biddaloy-backup-test scripts/backup >/dev/null
[ "$(docker run --rm --entrypoint id biddaloy-backup-test -u)" = "10001" ] \
  && pass "backup runs as uid 10001" || fail "backup is not uid 10001"

run_env=(-e DATABASE_URL=postgres://x -e BACKUP_AGE_PUBLIC_KEY=age1x -e S3_BUCKET=b
  -e S3_ENDPOINT=http://x -e S3_REGION=r -e S3_ACCESS_KEY_ID=x -e S3_SECRET_ACCESS_KEY=topsecret)

# No BACKUP_SCHEDULE and no R2 vars: legacy mode keeps the once-a-day default.
out="$(docker run --rm "${run_env[@]}" --entrypoint sh biddaloy-backup-test \
  -c '/app/entrypoint.sh & sleep 2; cat /app/crontab' 2>&1 || true)"
echo "$out" | grep -q 'starting supercronic' && pass "supercronic starts" || fail "supercronic did not start"
echo "$out" | grep -qx '0 2 \* \* \* /app/backup.sh' && pass "legacy default schedule is daily" || fail "legacy default schedule is not 0 2 * * *"
echo "$out" | grep -q 'topsecret' && fail "secret leaked into crontab/log" || pass "no secret in crontab"

# A regressed check would exec supercronic, which never exits: the timeout
# turns that hang into a FAIL. 0 = accepted and exited, 124 = accepted and
# still running; anything else is the entrypoint rejecting the schedule.
rc=0
timeout -k 5 20 docker run --rm "${run_env[@]}" -e BACKUP_SCHEDULE='* * * * * ; rm -rf /' \
  biddaloy-backup-test >/dev/null 2>&1 || rc=$?
{ [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ]; } || fail "injection schedule was accepted (exit $rc)"
pass "injected BACKUP_SCHEDULE is rejected"

# A copied .env.example placeholder for the crypt password must stop the
# container before supercronic starts (exit 1, not a hang).
rc=0
out="$(timeout -k 5 20 docker run --rm "${run_env[@]}" -e BACKUP_S3_ENDPOINT=https://r2.example \
  -e BACKUP_S3_BUCKET=b -e BACKUP_S3_ACCESS_KEY_ID=k -e BACKUP_S3_SECRET_ACCESS_KEY=0123456789abcdef0123 \
  -e BACKUP_RCLONE_CRYPT_PASSWORD=change-me -e BACKUP_RCLONE_CRYPT_SALT=0123456789abcdef0123 \
  biddaloy-backup-test 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "placeholder crypt password was accepted (exit $rc)"
grep -q 'BACKUP_RCLONE_CRYPT_PASSWORD is a placeholder' <<<"$out" \
  || fail "exit 1 was not the placeholder check: $out"
pass "placeholder crypt password is rejected"
