#!/usr/bin/env bash
# Tests for deploy/bin/biddaloy-doctor. Pure bash: docker, systemctl, df, free, timedatectl and
# openssl are shims on a private PATH; BIDDALOY_ROOT points at a temp tree. Nothing real runs.
#   bash deploy/bin/test/biddaloy-doctor.test.sh
# The shims are single-quoted on purpose (their variables expand when they run, not here).
# shellcheck disable=SC2016,SC2155,SC2086,SC2001
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCTOR="$HERE/../biddaloy-doctor"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
BIN="$T/bin"; ROOT="$T/root"; mkdir -p "$BIN" "$ROOT" "$ROOT/staging"
SHA="$(printf 'a%.0s' {1..40})"
TOKEN="FAKE-HEALTH-TOKEN-0123456789"
PASS=0; FAIL=0

# Real tools the doctor needs, linked into the private PATH (jq only if the machine has it).
for t in stat bash env awk sed grep sort tail head tr wc date cat tee dirname readlink rm jq python3; do
  p="$(command -v "$t" 2>/dev/null)" && ln -s "$p" "$BIN/$t"
done

shim() { printf '#!/usr/bin/env bash\n%s\n' "$2" >"$BIN/$1"; chmod +x "$BIN/$1"; }

shim df 'if [ "${2:-}" = / ]; then u="$DF_ROOT"; else u="$DF_DOCKER"; fi
echo "Filesystem 1024-blocks Used Available Capacity Mounted"; echo "x 100 1 1 ${u}% $2"'
shim free 'echo "              total used free shared buff/cache available"
echo "Mem: 1000 300 200 0 100 $MEM_AVAIL"; echo "Swap: 1000 $SWAP_USED 0"'
shim timedatectl 'echo "$NTP"'
shim systemctl 'case "$*" in
  *list-units*) printf "%s" "$FAILED_UNITS" ;;
  *show*) echo "LoadState=${NIGHTLY_LOAD:-loaded}"; echo "Result=$NIGHTLY_RESULT"; echo "ExecMainExitTimestamp=Wed 2026-10-22 02:20:00 UTC" ;;
esac'
shim openssl 'case "$*" in
  *s_client*) [ -n "${CERT_SERVED-1}" ] && echo "-----BEGIN CERTIFICATE-----" ;;
  *-checkend*) prev=""; for a in "$@"; do [ "$prev" = -checkend ] && n="$a"; prev="$a"; done
    [ $((CERT_DAYS * 86400)) -gt "$n" ] ;;
  *-enddate*) echo "notAfter=Dec 31 00:00:00 2026 GMT" ;;
esac'
shim docker 'a="$*"
stack=""; prev=""; for x in "$@"; do [ "$prev" = -p ] && stack="$x"; prev="$x"; done
case "$a" in
  "ps -a"*) printf "%b" "$PS_LINES" ;;
  "logs --since 10m edge-cloudflared-1"*) printf "%b" "$TUNNEL_LOG" ;;
  *"ps --all --format json"*) cat "$ROOT_DIR/ps.$stack" 2>/dev/null ;;
  *"exec -T app"*) printf "%s" "$READY_CODE" ;;
  *"exec -T db"*) printf "%s\n%s\n" "$CONNS" "$MAXC" ;;
  *"exec -T backup"*) printf "%b" "$BACKUP_LS" ;;
esac'

shim curl 'case "$*" in
  *-K*) cat >/dev/null; printf "%s" "$UMAMI_CODE" ;;
  *sites.*) printf "%s" "$SITES_CODE" ;;
  *) printf "%s" "$PROBE_CODE" ;;
esac'

# --- fixture tree ---------------------------------------------------------------------------------
for s in prod staging demo; do
  mkdir -p "$ROOT/$s"
  printf 'POSTGRES_PASSWORD=hunter2-secret\nHEALTH_TOKEN=%s\n' "$TOKEN" >"$ROOT/$s/.env"
  printf '2026-10-22T01:00:00Z %s %s ok\n' "$s" "$SHA" >"$ROOT/$s/deploys.log"
  {
    echo "{\"Service\":\"app\",\"State\":\"running\",\"Health\":\"healthy\",\"Image\":\"ghcr.io/tareq89/biddaloy-app:$SHA\"}"
    echo '{"Service":"db","State":"running","Health":"healthy","Image":"postgres:18-alpine"}'
  } >"$ROOT/ps.$s"
done
mkdir -p "$ROOT/edge/letsencrypt/live/app.example.test"
: >"$ROOT/edge/letsencrypt/live/app.example.test/fullchain.pem"
set_mode() { printf 'EDGE_MODE=%s\nAPP_DOMAIN=app.example.test\nROOT_DOMAIN=schools.test\n' "$1" >"$ROOT/edge/.env"; }

key_ago() { # key_ago <minutes>: an `aws s3 ls` line for a backup that old
  local e k; e=$(($(date -u +%s) - $1 * 60))
  k="$(date -u -d "@$e" +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -r "$e" +%Y%m%dT%H%M%SZ)"
  printf '2026-10-22 03:00:01   12345 %s.dump.age\\n' "$k"
}

defaults() {
  export ROOT_DIR="$ROOT" BIDDALOY_ROOT="$ROOT" PATH="$BIN"
  export DF_ROOT=50 DF_DOCKER=40 MEM_AVAIL=600 SWAP_USED=0 NTP=yes FAILED_UNITS="" NIGHTLY_RESULT=success NIGHTLY_LOAD=loaded
  export CERT_DAYS=60 READY_CODE=200 CONNS=10 MAXC=100 TUNNEL_LOG="Registered tunnel connection\n"
  export PS_LINES="edge-nginx-1|Up 2 hours (healthy)\nedge-landing-1|Up 2 hours (healthy)\nedge-cloudflared-1|Up 2 hours (healthy)\nstaging-mailpit-1|Up 2 hours (healthy)\ndemo-mailpit-1|Up 2 hours (healthy)\nprod-site-1|Up 2 hours (healthy)\n"
  export PROBE_CODE=404 SITES_CODE=404 UMAMI_CODE=200
  export BACKUP_LS="$(key_ago 10)"
  set_mode tunnel
  echo "2026-10-29T02:30:00+0600 duration=420s schools=1 users=2 students=3" >"$ROOT/staging/last-drill"
}

OUT=""; RC=0
run() { OUT="$(bash "$DOCTOR" "$@" 2>&1)"; RC=$?; }

check() { # check <name> <cmd...>
  local n="$1"; shift
  if "$@"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: $n"; echo "$OUT" | sed 's/^/    /'; fi
}
row() { printf '%s\n' "$OUT" | grep -Eq "^$1 +$2 "; }                 # row "disk /" FAIL
row_next() { printf '%s\n' "$OUT" | grep -A1 -E "^$1 +$2 " | tail -1 | grep -q '^  Next: .'; }
nrow() { ! printf '%s\n' "$OUT" | grep -Eq "^$1 "; }              # no row of that name
rc_is() { [ "$RC" -eq "$1" ]; }

# --- all OK ---------------------------------------------------------------------------------------
defaults; run
check "all healthy exits 0" rc_is 0
check "all healthy has no Next line" bash -c '! printf "%s\n" "$0" | grep -q "Next:"' "$OUT"
check "overall OK" bash -c 'printf "%s\n" "$0" | grep -q "^overall: OK"' "$OUT"

# --- disk boundaries (free%: 20 ok, 19 warn, 10 warn, 9 fail) ---------------------------------------
for c in "80 OK 0" "81 WARN 1" "90 WARN 1" "91 FAIL 2"; do
  set -- $c; defaults; export DF_ROOT=$1; run
  check "disk use $1 -> $2" row "disk /" "$2"
  check "disk use $1 exit $3" rc_is "$3"
  [ "$2" = OK ] || check "disk use $1 has Next" row_next "disk /" "$2"
done
defaults; export DF_ROOT=95; run
check "disk 95% -> FAIL, exit 2" rc_is 2
defaults; export DF_DOCKER=95; run
check "docker dir FAIL" row "disk /var/lib/docker" FAIL

# --- memory, time, units ----------------------------------------------------------------------------
defaults; export MEM_AVAIL=80; run
check "low memory WARN" row memory WARN
defaults; export MEM_AVAIL=30; run
check "very low memory FAIL" row memory FAIL
defaults; export SWAP_USED=600; run
check "swap use WARN" row memory WARN
defaults; export NTP=no; run
check "time sync WARN with Next" row_next "time sync" WARN
defaults; export FAILED_UNITS="biddaloy-nightly@demo-rebuild.service loaded failed failed x"; run
check "failed nightly unit FAIL" row "nightly units" FAIL
defaults; export NIGHTLY_RESULT=exit-code; run
check "nightly result FAIL" row "nightly demo-rebuild" FAIL
defaults; export NIGHTLY_LOAD=not-found; run
check "missing nightly unit WARN" row "nightly demo-rebuild" WARN

# --- restore drill record (88 D13): fresh OK, stale WARN, missing WARN ----------------------------------
drill_file() { # <hours old>
  echo "2026-10-29T02:30:00+0600 duration=420s schools=1 users=2 students=3" >"$ROOT/staging/last-drill"
  python3 -c 'import os,sys,time; t=time.time()-int(sys.argv[2])*3600; os.utime(sys.argv[1],(t,t))' "$ROOT/staging/last-drill" "$1"
}
defaults; drill_file 3; run
check "fresh drill file OK" row "restore drill" OK
defaults; drill_file 30; run
check "stale drill file WARN" row "restore drill" WARN
defaults; rm -f "$ROOT/staging/last-drill"; run
check "missing drill file WARN" row "restore drill" WARN
# provision touches it empty and fresh: still no drill, never a fresh OK
defaults; : >"$ROOT/staging/last-drill"; run
check "empty fresh drill file WARN" row "restore drill" WARN
defaults; run
check "no staging-refresh unit expected" nrow "nightly staging-refresh"
# `biddaloy-doctor staging` shows the drill line too (the runbooks tell the operator to run it)
defaults; drill_file 3; run staging
check "staging-only run shows the drill line" row "restore drill" OK
defaults; drill_file 3; run prod
check "prod-only run has no drill line" nrow "restore drill"

# --- backup age (OK <=70, WARN 71..130, FAIL >130) ----------------------------------------------------
for c in "69 OK 0" "71 WARN 1" "129 WARN 1" "131 FAIL 2"; do
  set -- $c; defaults; export BACKUP_LS; BACKUP_LS="$(key_ago "$1")"; run
  check "backup ${1} min -> $2" row "backup age" "$2"
  check "backup ${1} min exit $3" rc_is "$3"
  [ "$2" = OK ] || check "backup ${1} min has Next" row_next "backup age" "$2"
done
defaults; export BACKUP_LS="backup 3 h old"; BACKUP_LS="$(key_ago 180)"; run
check "backup 3 h old FAIL" row "backup age" FAIL
defaults; export BACKUP_LS=""; run
check "no backup FAIL" row "backup age" FAIL

# --- cert (direct mode): OK 21 days, WARN 19, FAIL expired ------------------------------------------------
defaults; set_mode direct; export CERT_DAYS=21; run
check "cert 21 days OK" row "cert expiry" OK
defaults; set_mode direct; export CERT_DAYS=19; run
check "cert 19 days WARN" row "cert expiry" WARN
defaults; set_mode direct; export CERT_DAYS=0; run
check "cert expired FAIL" row "cert expiry" FAIL
defaults; set_mode direct; export CERT_SERVED=""; run
check "no certificate served on 443 WARN" row "cert expiry" WARN
unset CERT_SERVED

# --- edge, tunnel, stacks ------------------------------------------------------------------------------------
defaults; export PS_LINES="edge-nginx-1|Up 1 hour (unhealthy)\nedge-landing-1|Up 1 hour (healthy)\n"; run
check "unhealthy nginx FAIL" row "container edge-nginx-1" FAIL
check "missing cloudflared FAIL" row "container edge-cloudflared-1" FAIL
defaults; export PS_LINES="edge-nginx-1|Up 1 hour (healthy)\nedge-landing-1|Up 1 hour (healthy)\nedge-cloudflared-1|Up 1 hour (healthy)\ndemo-mailpit-1|Up 1 hour (healthy)\n"; run
check "missing staging mailpit FAIL" row "container staging-mailpit-1" FAIL
check "prod has no mailpit check" nrow "container prod-mailpit-1"
defaults; export TUNNEL_LOG=""; run
check "no tunnel connection FAIL" row "tunnel connections" FAIL
defaults; echo '{"Service":"app","State":"running","Health":"unhealthy","Image":"x:1"}' >"$ROOT/ps.staging"; run
check "unhealthy service FAIL" row "staging services" FAIL
check "unhealthy service exit 2" rc_is 2
{ echo "{\"Service\":\"app\",\"State\":\"running\",\"Health\":\"healthy\",\"Image\":\"x:$SHA\"}"; } >"$ROOT/ps.staging"
defaults; export READY_CODE=503; run
check "ready 503 FAIL" row "prod ready" FAIL
defaults; export CONNS=85; run
check "85% connections WARN" row "prod db connections" WARN
defaults; export CONNS=96; run
check "96% connections FAIL" row "prod db connections" FAIL
defaults; printf '2026-10-22T01:00:00Z prod %s ok\n' "$(printf 'b%.0s' {1..40})" >"$ROOT/prod/deploys.log"; run
check "tag differs from last ok -> WARN" row "prod version" WARN
check "version WARN has Next" row_next "prod version" WARN
printf '2026-10-22T01:00:00Z prod %s ok\n' "$SHA" >"$ROOT/prod/deploys.log"

# --- limit to one stack ----------------------------------------------------------------------------------------
defaults; run staging
check "stack arg: staging rows only" bash -c 'printf "%s\n" "$0" | grep -q "^staging services" && ! printf "%s\n" "$0" | grep -Eq "^(prod |disk|memory|backup)"' "$OUT"
defaults; run prod
check "prod arg includes backup" row "backup age" OK
defaults; run bogus
check "bad arg exits 64" rc_is 64

# --- --json ------------------------------------------------------------------------------------------------------
defaults; export DF_ROOT=95; run --json
json_ok() {
  if command -v jq >/dev/null 2>&1; then printf '%s' "$OUT" | jq -e '.status=="FAIL" and (.checks|length)>5' >/dev/null
  else printf '%s' "$OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"]=="FAIL" and len(d["checks"])>5'; fi
}
check "--json parses" json_ok
check "--json keeps exit code 2" rc_is 2
check "--json is one document" bash -c '[ "$(printf "%s\n" "$0" | wc -l | tr -d " ")" = 1 ]' "$OUT"

# --- no secret leakage -----------------------------------------------------------------------------------------------
defaults; export DF_ROOT=95 READY_CODE=503 NTP=no; run; H="$OUT"; run --json; J="$OUT"
check "token never printed" bash -c '! printf "%s%s" "$0" "$1" | grep -qE "FAKE-HEALTH-TOKEN|hunter2-secret"' "$H" "$J"

# --- school websites (#3655): site container, Cloudflare env, probes, Umami ------------------------------
site_env() { printf 'POSTGRES_PASSWORD=hunter2-secret\nHEALTH_TOKEN=%s\n%b' "$TOKEN" "$1" >"$ROOT/prod/.env"; }
defaults; run
check "site container present OK" row "container prod-site-1" OK
check "no CF env is OK (custom domains off)" row "custom domains env" OK
check "probes 404 OK" row "site probe doctor-probe.schools.test" OK
check "sites. probe 404 OK" row "site probe sites.schools.test" OK
check "no Umami env is OK" row "umami api" OK
defaults; export PS_LINES="edge-nginx-1|Up 2 hours (healthy)\nedge-landing-1|Up 2 hours (healthy)\nedge-cloudflared-1|Up 2 hours (healthy)\n"; run
check "absent site container FAIL" row "container prod-site-1" FAIL
check "absent site container exit 2" rc_is 2
defaults; export PROBE_CODE=502; run
check "wildcard probe 502 WARN" row "site probe doctor-probe.schools.test" WARN
check "wildcard probe WARN has Next" row_next "site probe doctor-probe.schools.test" WARN
defaults; export SITES_CODE=000; run
check "fallback origin probe not 404 WARN" row "site probe sites.schools.test" WARN
defaults; site_env 'CF_SAAS_API_TOKEN=tok-secret\nCF_ZONE_ID=zone1\n'; run
check "CF token + zone OK" row "custom domains env" OK
defaults; site_env 'CF_SAAS_API_TOKEN=tok-secret\n'; run
check "CF token without zone WARN" row "custom domains env" WARN
check "CF half-set WARN has Next" row_next "custom domains env" WARN
defaults; site_env 'CF_ZONE_ID=zone1\n'; run
check "CF zone without token WARN" row "custom domains env" WARN
defaults; site_env 'UMAMI_API_URL=https://stats.example.test\nUMAMI_API_TOKEN=umami-secret\n'; run
check "Umami reachable OK" row "umami api" OK
defaults; site_env 'UMAMI_API_URL=https://stats.example.test\nUMAMI_API_TOKEN=umami-secret\n'; export UMAMI_CODE=401; run
check "Umami 401 WARN" row "umami api" WARN
defaults; site_env 'UMAMI_API_URL=https://stats.example.test\n'; run
check "Umami half-set WARN" row "umami api" WARN
defaults; site_env 'CF_SAAS_API_TOKEN=tok-secret\nUMAMI_API_TOKEN=umami-secret\n'; run; H="$OUT"; run --json
check "CF / Umami tokens never printed" bash -c '! printf "%s%s" "$0" "$1" | grep -qE "tok-secret|umami-secret"' "$H" "$OUT"
defaults; printf 'EDGE_MODE=tunnel\nAPP_DOMAIN=app.example.test\n' >"$ROOT/edge/.env"; run
check "no ROOT_DOMAIN WARN" row "school websites" WARN
defaults; site_env ''; run prod
check "prod-only run has no site probes" nrow "site probe doctor-probe.schools.test"
site_env ""

# --- missing tool => WARN, not a crash ----------------------------------------------------------------------------------
defaults; rm -f "$BIN/free" "$BIN/docker"; run
check "missing free -> WARN" row memory WARN
check "missing docker -> WARN" row "prod services" WARN
check "missing tool names the tool" bash -c 'printf "%s\n" "$0" | grep -q "free not found"' "$OUT"
check "missing tool exit 1 (not a crash)" rc_is 1

echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
