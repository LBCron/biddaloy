#!/usr/bin/env bash
# Mirrors .github/workflows/ci.yml job-for-job — edit both together (#152).
# Sections run the same commands, in the same order, with no wrapping, so a
# failure here prints exactly what the CI job prints.
#
# Default:        verify + frontend + audit (no external services needed)
# --integration:  adds the integration section (self-provisions db+redis)
# --e2e:          adds the e2e section (self-provisions db+redis)
# --lighthouse:   adds the lighthouse section (self-provisions db+redis) —
#                 mirrors nightly-quality.yml's "lighthouse" job ([18.1.1]
#                 moved it off ci.yml's PR/push path onto a nightly
#                 schedule + workflow_dispatch; this flag's local shape is
#                 unchanged, only its CI counterpart moved)
# --storybook:    adds the storybook section (mirrors ci.yml's "Storybook
#                 build" job — PR-blocking in CI, opt-in here since it costs
#                 ~100s and most local runs don't touch Storybook content)
# --full:         everything, including --storybook
# --no-coverage:  frontend section runs yarn test:frontend --run instead of
#                 the coverage variant — faster, but NOT CI-equivalent (CI
#                 always collects coverage in the frontend job)
# --only a,b:     [18.4.3] run only the named section(s) — one of verify,
#                 frontend, storybook, landing, site, integration, e2e, audit,
#                 lighthouse, infra —
#                 instead of the default set / the flags above. Lets one CI
#                 job be replayed on its own.
# --affected:     [18.4.3] skip a section whose area (per the globs below,
#                 kept in sync with ci.yml's "changes" job) has no changes
#                 against origin/main — same job/area gating ci.yml itself
#                 uses (verify and audit are never gated, ci.yml runs them
#                 unconditionally too). Also passes --changed origin/main to
#                 the frontend section's vitest run.
#
# Deliberately NOT mirrored here — see #441's PR description for why:
#   - bundle-delta (ci.yml's "bundle-delta" job): PR-comment-only, reads two
#     already-built reports and diffs them; nothing to reproduce locally
#     that check:route-chunks below doesn't already cover.
#   - codeql (.github/workflows/codeql.yml): GitHub-hosted static analysis,
#     no local equivalent to run.
set -euo pipefail
cd "$(dirname "$0")/.."

# [15.6] Fail fast, before any of the ~90s+ work below burns on the wrong
# Node major — see scripts/check-node-version.mjs's own header comment.
node scripts/check-node-version.mjs

RUN_INTEGRATION=0
RUN_E2E=0
RUN_LIGHTHOUSE=0
RUN_STORYBOOK=0
COVERAGE=1
ONLY_SET=0
ONLY_LIST=()
AFFECTED=0

usage() {
  echo "usage: $(basename "$0") [--integration] [--e2e] [--lighthouse] [--storybook] [--full] [--no-coverage] [--only <job,job,...>] [--affected]" >&2
  echo "  --only accepts: verify, frontend, storybook, landing, site, integration, e2e, audit, lighthouse, infra" >&2
}

VALID_JOBS="verify frontend storybook landing site integration e2e audit lighthouse infra"

args=("$@")
i=0
while [ $i -lt ${#args[@]} ]; do
  arg="${args[$i]}"
  case "$arg" in
    --integration) RUN_INTEGRATION=1 ;;
    --e2e) RUN_E2E=1 ;;
    --lighthouse) RUN_LIGHTHOUSE=1 ;;
    --storybook) RUN_STORYBOOK=1 ;;
    --full) RUN_INTEGRATION=1; RUN_E2E=1; RUN_LIGHTHOUSE=1; RUN_STORYBOOK=1 ;;
    --no-coverage) COVERAGE=0 ;;
    --affected) AFFECTED=1 ;;
    --only)
      i=$((i + 1))
      if [ $i -ge ${#args[@]} ]; then
        echo "--only requires a value" >&2
        usage
        exit 2
      fi
      ONLY_SET=1
      ONLY_LIST=()
      IFS=',' read -r -a ONLY_LIST <<< "${args[$i]}"
      for job in "${ONLY_LIST[@]}"; do
        case " $VALID_JOBS " in
          *" $job "*) : ;;
          *)
            echo "unknown --only job: $job" >&2
            usage
            exit 2
            ;;
        esac
      done
      ;;
    --only=*)
      ONLY_SET=1
      IFS=',' read -r -a ONLY_LIST <<< "${arg#--only=}"
      for job in "${ONLY_LIST[@]}"; do
        case " $VALID_JOBS " in
          *" $job "*) : ;;
          *)
            echo "unknown --only job: $job" >&2
            usage
            exit 2
            ;;
        esac
      done
      ;;
    *) echo "unknown flag: $arg" >&2; usage; exit 2 ;;
  esac
  i=$((i + 1))
done

# [18.4.3] Mirror of ci.yml's "changes" job path-filter globs — keep in
# sync by hand; see .github/workflows/ci.yml's `changes` job (#152 note
# above applies to this whole file).
CI_PATHS_FRONTEND=(
  'ui/**'
  'client-admin/**'
  'shared/**'
  'e2e/**'
  'scripts/coverage-offenders.mjs'
  'scripts/coverage-delta.mjs'
  'scripts/bundle-delta.mjs'
  'scripts/ci-audit.js'
  'scripts/ci-audit.spec.mjs'
  'scripts/ci-timings.mjs'
  'scripts/ci-timings.spec.mjs'
  'scripts/ci-timings-trend.mjs'
  'scripts/ci-timings-trend.spec.mjs'
  'scripts/flake-report.mjs'
  'scripts/flake-report.spec.mjs'
  'scripts/check-arch-docs.spec.mjs'
  'docs/architecture/**'
  'CLAUDE.md'
  'server/CLAUDE.md'
  'ci-budgets.json'
  'quarantine.json'
  'package.json'
  'yarn.lock'
  'vitest.config.ts'
  'playwright.config.ts'
  '.github/workflows/ci.yml'
)
CI_PATHS_SERVER=(
  'server/**'
  'shared/**'
  'scripts/ci-timings.mjs'
  'scripts/ci-timings.spec.mjs'
  'scripts/ci-timings-trend.mjs'
  'scripts/ci-timings-trend.spec.mjs'
  'ci-budgets.json'
  'package.json'
  'yarn.lock'
  '.github/workflows/ci.yml'
)
# Mirror of ci.yml's `changes` job "landing" filter — keep in sync.
CI_PATHS_LANDING=(
  'landing/**'
  'ui/src/styles/globals.css'
  'yarn.lock'
  'package.json'
  '.github/workflows/ci.yml'
)
# Mirror of ci.yml's `changes` job "site" filter (Epic 40) — keep in sync.
CI_PATHS_SITE=(
  'site/**'
  'site-themes/**'
  'shared/src/**'
  'yarn.lock'
  'package.json'
  '.github/workflows/ci.yml'
)
# Mirror of ci.yml's `changes` job "api-surface" filter — keep in sync.
CI_PATHS_API_SURFACE=(
  'server/src/**'
  'ui/src/api/**'
)
# Mirror of ci.yml's `changes` job "infra" filter — keep in sync.
CI_PATHS_INFRA=(
  'nginx/**'
  'docker-compose.yml'
  'Dockerfile'
  'deploy/**'
  'scripts/backup/**'
  'scripts/demo/**'
  'docker-compose.build.yml'
  'site/public/maintenance.html'
  'infra/ansible/templates/cloudflared-config.yml.j2'
  '**/*.infra.test.sh'
  '.github/workflows/ci.yml'
)
CI_PATHS_UI=(
  'ui/**'
  'yarn.lock'
  'package.json'
)

CHANGED_FILES=()
if [ "$AFFECTED" = 1 ]; then
  # Committed diff against origin/main, PLUS working-tree changes (staged
  # and unstaged) and untracked files — a plain `origin/main...HEAD` diff
  # only sees commits, so uncommitted local work (the normal state while
  # actually iterating) would be silently invisible to --affected.
  while IFS= read -r line; do
    [ -n "$line" ] && CHANGED_FILES+=("$line")
  done < <(
    {
      git diff --name-only origin/main...HEAD
      git diff --name-only HEAD
      git ls-files --others --exclude-standard
    } | sort -u
  )
fi

# path_matches(file, pattern) — dorny/paths-filter-style glob: a
# 'dir/**' pattern is a prefix match, anything else is an exact match.
path_matches() {
  local file="$1" pattern="$2" prefix
  case "$pattern" in
    *"/**")
      prefix="${pattern%/**}/"
      [[ "$file" == "$prefix"* ]]
      ;;
    *)
      [ "$file" = "$pattern" ]
      ;;
  esac
}

# area_touched(area) — true if any changed file matches that area's globs.
area_touched() {
  local area="$1" f p
  local -a patterns
  case "$area" in
    frontend) patterns=("${CI_PATHS_FRONTEND[@]}") ;;
    server) patterns=("${CI_PATHS_SERVER[@]}") ;;
    ui) patterns=("${CI_PATHS_UI[@]}") ;;
    infra) patterns=("${CI_PATHS_INFRA[@]}") ;;
    landing) patterns=("${CI_PATHS_LANDING[@]}") ;;
    site) patterns=("${CI_PATHS_SITE[@]}") ;;
    api-surface) patterns=("${CI_PATHS_API_SURFACE[@]}") ;;
  esac
  # `set -u` treats an empty array's "${arr[@]}" as unbound on this
  # bash — guard the loop on the count instead of the expansion.
  [ ${#CHANGED_FILES[@]} -eq 0 ] && return 1
  for f in "${CHANGED_FILES[@]}"; do
    for p in "${patterns[@]}"; do
      path_matches "$f" "$p" && return 0
    done
  done
  return 1
}

# should_run(section) — decides whether a named section runs, folding in
# --only, the default/flag selection, and --affected area gating. Mirrors
# ci.yml's per-job `if: needs.changes.outputs...` conditions (verify and
# audit are unconditional there too).
should_run() {
  local name="$1"
  if [ "$ONLY_SET" = 1 ]; then
    local found=0 j
    for j in "${ONLY_LIST[@]}"; do
      [ "$j" = "$name" ] && found=1
    done
    [ "$found" = 1 ] || return 1
  else
    case "$name" in
      verify | frontend | audit | infra | landing | site) : ;;
      storybook) [ "$RUN_STORYBOOK" = 1 ] || return 1 ;;
      integration) [ "$RUN_INTEGRATION" = 1 ] || return 1 ;;
      e2e) [ "$RUN_E2E" = 1 ] || return 1 ;;
      lighthouse) [ "$RUN_LIGHTHOUSE" = 1 ] || return 1 ;;
    esac
  fi
  if [ "$AFFECTED" = 1 ]; then
    case "$name" in
      # ci.yml's "frontend" and "e2e" jobs both gate on the `frontend` area
      # (see ci.yml's line-519 comment on the e2e job).
      frontend | e2e)
        area_touched frontend || return 1
        ;;
      # Mirrors ci.yml's "integration" job, which gates on `server ||
      # api-surface` — a `ui/src/api/**`-only change (no other server/**
      # file touched) still needs integration locally, same as in CI.
      integration)
        area_touched server || area_touched api-surface || return 1
        ;;
      storybook)
        area_touched ui || return 1
        ;;
      infra)
        area_touched infra || return 1
        ;;
      landing)
        area_touched landing || return 1
        ;;
      site)
        area_touched site || return 1
        ;;
      # verify, audit, lighthouse: no ci.yml area gating to mirror.
    esac
  fi
  return 0
}

SUMMARY=()
SECTION_START=0
section() {
  echo ""
  echo "=== $1 ==="
  SECTION_START=$(date +%s)
}
section_done() {
  SUMMARY+=("$1: $(($(date +%s) - SECTION_START))s")
}

# This run's own database / Redis slots / S3 bucket on the shared `biddaloy`
# Docker stack — never new containers, and never a fixed DB name another
# worktree's ci:local could be using at the same time. See scripts/test-env.sh.
# Env values mirror ci.yml's throwaway CI-only secrets.
TEST_ENV_UP=""
test_env_down() {
  [ -n "$TEST_ENV_UP" ] && bash scripts/test-env.sh down || true
}
trap test_env_down EXIT
provision_stack() {
  if [ -z "$TEST_ENV_UP" ]; then
    TEST_ENV_UP="$(bash scripts/test-env.sh up)"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$TEST_ENV_UP"
  set +a
}
# The integration section's vitest global-setup drops the run's database and
# re-creates it with test fixtures only (no `default-school`), so a later
# section that runs migrations + `seed` needs its own fresh slice, the way each
# CI job gets its own database. Reusing it broke every platform SUPER_ADMIN and
# /admission/default-school e2e spec under `--full`.
fresh_stack() {
  test_env_down
  TEST_ENV_UP=""
  provision_stack
}

if should_run "verify"; then
  section "verify"
  yarn install --frozen-lockfile
  yarn build:shared
  yarn build:server
  # [18.4.3] mirrors 18.4.1's typecheck change: one `yarn typecheck` (root
  # `tsc -b`, which already references shared/ui/client-admin/
  # client-admin's sw project/server's lint project/e2e — see root
  # tsconfig.json) instead of the four separate tsc calls `yarn lint`,
  # `yarn workspace @biddaloy/ui lint`, `yarn workspace @biddaloy/client-admin
  # lint` (two tsc passes) and `npx tsc -p e2e/tsconfig.json` used to run
  # one at a time. eslint isn't part of `tsc -b`, so it still runs on its
  # own for the two workspaces that lint it.
  yarn typecheck
  yarn workspace @biddaloy/ui eslint .
  yarn workspace @biddaloy/client-admin eslint .
  yarn test:unit
  yarn workspace @biddaloy/client-admin check:route-chunks
  yarn workspace @biddaloy/ui check:exports
  yarn workspace @biddaloy/ui check:contrast
  yarn workspace @biddaloy/ui check:raw-palette
  yarn workspace @biddaloy/ui check:i18n
  yarn knip || echo "knip: non-blocking, exactly as in CI"
  section_done "verify"
fi

if should_run "frontend"; then
  section "frontend"
  # [18.5.1] ci.yml's "frontend" job shards this 3-way on CI and merges the
  # reports in a separate "frontend-merge" job — not mirrored here: one
  # local machine gets no wall-clock win from splitting a suite across
  # matrix legs it still has to run serially, so this stays a single
  # unsharded run, same as before.
  #
  # [#437] ci.yml also runs the quarantined tests non-blockingly here
  # (`QUARANTINE_MODE=only`, guarded on quarantine.json being non-empty) —
  # deliberately not mirrored locally: on an empty list it would still spend
  # a second near-full frontend run transforming/importing ~200 files for
  # zero information, the same cost ci.yml's own comment on that step flags.
  FRONTEND_EXTRA_ARGS=()
  if [ "$AFFECTED" = 1 ]; then
    FRONTEND_EXTRA_ARGS=(--changed origin/main)
  fi
  if [ "$COVERAGE" = 1 ]; then
    yarn test:frontend:coverage ${FRONTEND_EXTRA_ARGS[@]+"${FRONTEND_EXTRA_ARGS[@]}"}
  else
    yarn test:frontend --run ${FRONTEND_EXTRA_ARGS[@]+"${FRONTEND_EXTRA_ARGS[@]}"}
  fi
  section_done "frontend"
fi

if should_run "landing"; then
  section "landing"
  yarn workspace @biddaloy/landing build
  node landing/scripts/check-tokens.mjs
  section_done "landing"
fi

if should_run "site"; then
  section "site"
  yarn build:shared
  yarn build:site-themes
  yarn workspace @biddaloy/site build
  yarn workspace @biddaloy/site test
  section_done "site"
fi

if should_run "storybook"; then
  section "storybook"
  yarn workspace @biddaloy/ui build-storybook
  section_done "storybook"
fi

if should_run "integration"; then
  section "integration"
  provision_stack
  yarn workspace @biddaloy/server docs:generate
  yarn workspace @biddaloy/ui check:api-types
  yarn test:integration
  # CI=1 makes vitest fail on a missing or changed snapshot (e.g.
  # server/src/route-status.snapshot.txt) instead of writing it, as on CI.
  CI=1 yarn test:e2e
  section_done "integration"
fi

if should_run "e2e"; then
  section "e2e"
  fresh_stack
  yarn workspace @biddaloy/server migration:run
  yarn workspace @biddaloy/server seed
  # CI=1 mirrors the pipeline and stops playwright.config.ts's
  # reuseExistingServer from grabbing an already-running dev server wired
  # to the dev database — that mismatch fails login against the freshly
  # seeded test-env database. If dev servers hold ports 3000/5174,
  # Playwright now fails fast with a clear port-in-use message instead.
  # Mirrors ci.yml's "e2e" job (18.2.3): chromium project plus the PWA
  # suite, no sharding.
  #
  # #766: deliberately NOT setting E2E_SKIP_BUILD here, unlike ci.yml's e2e
  # job. That job skips its build because it downloads verify's build-dist
  # artifact; there's no equivalent artifact-download step locally, and
  # e2e:serve:client's build is the only thing that ever produces
  # client-admin/dist in this script (check:route-chunks above builds into
  # its own temp dir, not client-admin/dist). Setting it here would silently
  # serve a stale or missing dist instead of failing loudly.
  # Two separate commands, not `a && b`: under `set -e` a failure in the left
  # side of `&&` doesn't abort the script, so a red chromium run used to
  # report success and silently skip the PWA suite.
  CI=1 yarn e2e --project=chromium
  CI=1 yarn e2e:pwa
  section_done "e2e"
fi

if should_run "lighthouse"; then
  section "lighthouse"
  fresh_stack
  yarn workspace @biddaloy/server migration:run
  yarn workspace @biddaloy/server seed
  # Production builds on both sides, same as the CI lighthouse job —
  # never the dev servers.
  yarn build:server
  node server/dist/main.js &
  LH_SERVER_PID=$!
  cleanup_lighthouse() {
    kill "$LH_SERVER_PID" 2>/dev/null || true
    if [ -n "${LH_PREVIEW_PID:-}" ]; then
      kill "$LH_PREVIEW_PID" 2>/dev/null || true
    fi
  }
  trap 'cleanup_lighthouse; test_env_down' EXIT
  yarn build:client-admin
  yarn workspace @biddaloy/client-admin preview --port 5174 &
  LH_PREVIEW_PID=$!
  npx wait-on tcp:3000 tcp:5174 --timeout 120000
  STUDENT_URL="$(node scripts/lighthouse-student-url.mjs)"
  npx lhci autorun \
    --collect.url=http://localhost:5174/login \
    --collect.url=http://localhost:5174/fees/dues \
    --collect.url="$STUDENT_URL"
  cleanup_lighthouse
  trap test_env_down EXIT
  section_done "lighthouse"
fi

if should_run "audit"; then
  section "audit"
  node scripts/ci-audit.js
  node scripts/ci-audit.js --production
  node scripts/check-tracked-files.mjs
  section_done "audit"
fi

if should_run "infra"; then
  section "infra"
  # The only ci:local step that starts containers (docker-driven nginx tests),
  # so it is opt-in. CI always runs it via ci.yml's `infra` job.
  if [ "${CI_LOCAL_INFRA:-}" = 1 ] && docker info >/dev/null 2>&1; then
    for t in $(git ls-files '*.infra.test.sh'); do
      echo "--- $t"
      bash "$t"
    done
  else
    echo "infra: skipped (set CI_LOCAL_INFRA=1 and have docker running)"
  fi
  section_done "infra"
fi

echo ""
echo "=== summary ==="
if [ ${#SUMMARY[@]} -gt 0 ]; then
  for line in "${SUMMARY[@]}"; do echo "  $line"; done
else
  echo "  (no sections ran — check --only/--affected)"
fi
