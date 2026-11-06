#!/usr/bin/env bash
# [Epic 40, #3620] School-site route. School names (<sub>.ROOT_DOMAIN) are served by a SEPARATE
# nginx listener (:8081) that holds only the site server{} and a default 444, never a fixed host
# (runbook part 17a: cloudflared matches host names case-sensitively, so the school-site rule must
# not share a listener with staging / ops). Checks, in both edge modes:
#   - fixed hosts and unknown hosts are untouched (444), the site host is NOT served on :80
#   - a school host reaches `site`, cached 30 s (HIT), stale when `site` is down (STALE), the
#     maintenance page (503) on an empty cache
#   - /media/* is long-cached by nginx although the API says no-store; /_api/* maps to the API
#   - the preview route on the app host, X-Site-Preview stripped from public requests, no Cookie
#     reaches `site`
# Same harness as landing.infra.test.sh. Needs docker only. About 90 s (two 31 s cache waits).
#   bash nginx/test/site.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=site-test
LEVOL=site-test-le
CACHEVOL=site-test-cache
NGINX_IMG=nginx:1.31-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.97.10
ROOT=schools.test
FAILS=0

cleanup() {
  docker rm -f site-stub site-app-stub site-edge >/dev/null 2>&1 || true
  docker volume rm "$LEVOL" "$CACHEVOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.97.0/24 "$NET" >/dev/null
docker volume create "$LEVOL" >/dev/null

# Stub upstreams. `site` echoes what it received; `app` answers like the API (no-store).
stub() { # <name> <alias> <port> <nginx location body>; the body goes in as an env var so no $var is expanded here
  docker run -d --name "$1" --network "$NET" --network-alias "$2" -e "PORT=$3" -e "BODY=$4" --entrypoint sh "$NGINX_IMG" \
    -c 'printf "server { listen %s; location / { default_type text/plain; %s } }" "$PORT" "$BODY" > /etc/nginx/conf.d/default.conf && exec nginx -g "daemon off;"' >/dev/null
}
start_site_stub() {
  docker rm -f site-stub >/dev/null 2>&1 || true
  stub site-stub prod-site 4321 'return 200 "site-ok host=$host preview=[$http_x_site_preview] cookie=[$http_cookie] uri=$request_uri";'
}
start_site_stub
stub site-app-stub prod-app 3000 'add_header Cache-Control no-store; return 200 "app-ok uri=$request_uri host=$host";'

docker run --rm -v "$LEVOL:/le" --entrypoint sh alpine/openssl -c \
  'mkdir -p /le/live/example.test && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /le/live/example.test/privkey.pem -out /le/live/example.test/fullchain.pem -subj /CN=example.test' >/dev/null 2>&1

start_edge() { # <mode>
  docker rm -f site-edge >/dev/null 2>&1 || true
  docker volume rm "$CACHEVOL" >/dev/null 2>&1 || true
  docker volume create "$CACHEVOL" >/dev/null
  docker run -d --name site-edge --network "$NET" --ip "$EDGE_IP" -e "EDGE_MODE=$1" \
    -e EDGE_TRUSTED_CIDR=172.30.97.0/24 -e APP_DOMAIN=example.test -e "ROOT_DOMAIN=$ROOT" -e OPS_UPSTREAM_HOST= \
    -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
    -v "$PWD/nginx/edge-mode.sh:/docker-entrypoint.d/15-edge-mode.sh:ro" \
    -v "$PWD/site/public/maintenance.html:/usr/share/nginx/site-static/maintenance.html:ro" \
    -v "$CACHEVOL:/var/cache/nginx/site" \
    -v "$LEVOL:/etc/letsencrypt:ro" "$NGINX_IMG" >/dev/null
  for _ in $(seq 20); do
    docker exec site-edge nc -z 127.0.0.1 8081 >/dev/null 2>&1 && docker exec site-edge nc -z 127.0.0.1 80 >/dev/null 2>&1 && break
    sleep 1
  done
}

# Plain-HTTP helpers against <port> (80 fixed hosts, 8081 school sites). Empty / 000 on a dropped request.
RES() { echo "--resolve $2:$1:$EDGE_IP"; }
hdrs() { docker run --rm --network "$NET" "$CURL_IMG" -sI $(RES "$1" "$2") "http://$2:$1$3" | tr -d '\r' || true; }
body() { docker run --rm --network "$NET" "$CURL_IMG" -s $(RES "$1" "$2") "http://$2:$1$3" || true; }
code() { docker run --rm --network "$NET" "$CURL_IMG" -s -o /dev/null -w '%{http_code}' $(RES "$1" "$2") "http://$2:$1$3" || true; }
# like body, with one extra request header
body_h() { docker run --rm --network "$NET" "$CURL_IMG" -s -H "$4" $(RES "$1" "$2") "http://$2:$1$3" || true; }

run_mode() { # <mode>
  local mode=$1 h b c
  start_site_stub
  start_edge "$mode"
  docker exec site-edge nginx -t >/dev/null 2>&1 && pass "$mode: nginx -t" || fail "$mode: nginx -t" "non-zero"

  # --- fixed hosts and the unknown-host drop are untouched ---
  c=$(code 80 anything.example /); [ "$c" = 000 ] && pass "$mode: unknown host on :80 still dropped (444)" || fail "$mode: unknown host :80" "$c"
  c=$(code 80 "rumsc.$ROOT" /); [ "$c" = 000 ] && pass "$mode: school host is NOT served on the fixed-host listener :80" || fail "$mode: school host on :80" "$c"
  c=$(code 8081 anything.example /); [ "$c" = 000 ] && pass "$mode: unknown host on :8081 dropped (444)" || fail "$mode: unknown host :8081" "$c"
  c=$(code 8081 example.test /); [ "$c" = 000 ] && pass "$mode: fixed host (APP_DOMAIN) on :8081 dropped, listener holds no fixed host" || fail "$mode: fixed host :8081" "$c"
  if [ "$mode" = tunnel ]; then
    b=$(body 80 example.test /api/x); [[ "$b" == app-ok* ]] && pass "$mode: APP_DOMAIN on :80 unchanged" || fail "$mode: APP_DOMAIN :80" "$b"
  fi
  # The case trick (STAGING.<root> / staging.<root>) can only land on the site listener, where
  # there is no staging server{}: the site stub answers, never the app.
  b=$(body 8081 "STAGING.$ROOT" /bn/); [[ "$b" == site-ok* ]] && pass "$mode: case-changed fixed name on :8081 reaches site only" || fail "$mode: case trick" "$b"

  # --- school host: reaches site, micro-cache, stale-if-error, maintenance page ---
  b=$(body 8081 "rumsc.$ROOT" /bn/)
  [[ "$b" == "site-ok host=rumsc.$ROOT "* ]] && pass "$mode: rumsc.$ROOT reaches site with its Host" || fail "$mode: school host" "$b"
  h=$(hdrs 8081 "rumsc.$ROOT" /bn/)
  grep -qi '^x-cache-status: HIT' <<<"$h" && pass "$mode: second request within 30 s is a cache HIT" || fail "$mode: cache HIT" "$h"
  # Another school, same path: the cache key carries the host (else schools would share pages).
  b=$(body 8081 "other.$ROOT" /bn/)
  [[ "$b" == "site-ok host=other.$ROOT "* ]] && pass "$mode: cache is per host (other school not served rumsc's page)" || fail "$mode: cache per host" "$b"

  # Public requests cannot fake preview mode or carry cookies to the site container.
  b=$(body_h 8081 "rumsc.$ROOT" '/fresh/' 'X-Site-Preview: basic')
  [[ "$b" == *"preview=[]"* ]] && pass "$mode: X-Site-Preview from a public request is stripped" || fail "$mode: preview strip" "$b"
  b=$(body_h 8081 "rumsc.$ROOT" '/fresh2/' 'Cookie: sid=secret')
  [[ "$b" == *"cookie=[]"* ]] && pass "$mode: Cookie never reaches site" || fail "$mode: cookie strip" "$b"

  hdrs 8081 "rumsc.$ROOT" '/draft/?preview=tok' >/dev/null
  h=$(hdrs 8081 "rumsc.$ROOT" '/draft/?preview=tok')
  ! grep -qi '^x-cache-status: HIT' <<<"$h" && pass "$mode: ?preview= draft page is never cached" || fail "$mode: preview cached" "$h"

  # Wait out the 30 s validity, stop site: expired entry is served stale; unseen path -> maintenance page.
  sleep 31
  docker stop site-stub >/dev/null
  h=$(hdrs 8081 "rumsc.$ROOT" /bn/)
  grep -qi '^x-cache-status: STALE' <<<"$h" && pass "$mode: site down, expired page served STALE" || fail "$mode: STALE" "$h"
  h=$(hdrs 8081 "rumsc.$ROOT" /never-seen/)
  grep -q ' 503' <<<"$h" && pass "$mode: site down, empty cache -> 503" || fail "$mode: 503" "$h"
  b=$(body 8081 "rumsc.$ROOT" /never-seen/)
  [[ "$b" == *"Please try again in a moment"* ]] && pass "$mode: maintenance page body shown" || fail "$mode: maintenance body" "$b"
  start_site_stub

  # --- /media/*: long immutable cache from nginx, API's no-store hidden ---
  h=$(hdrs 8081 "rumsc.$ROOT" /media/abc.webp)
  grep -qi '^cache-control: public, max-age=31536000, immutable' <<<"$h" && ! grep -qi 'no-store' <<<"$h" \
    && pass "$mode: /media/ is public immutable, no no-store" || fail "$mode: media cache-control" "$h"
  b=$(body 8081 "rumsc.$ROOT" /media/abc.webp)
  [[ "$b" == "app-ok uri=/api/v1/public/site/by-host/rumsc.$ROOT/media/abc.webp "* ]] \
    && pass "$mode: /media/<key> maps to the by-host media API" || fail "$mode: media rewrite" "$b"

  # --- islands: straight to the API, not cached ---
  b=$(body 8081 "rumsc.$ROOT" '/_api/island/notices?page=2')
  [[ "$b" == "app-ok uri=/api/v1/public/site/by-host/rumsc.$ROOT/island/notices?page=2 "* ]] \
    && pass "$mode: /_api/island/notices -> API by-host route, query kept" || fail "$mode: island rewrite" "$b"
  h=$(hdrs 8081 "rumsc.$ROOT" '/_api/island/notices')
  ! grep -qi '^x-cache-status: HIT' <<<"$h" && pass "$mode: islands are not cached" || fail "$mode: island cached" "$h"

  # --- preview on the app host (a fixed host, :80 in tunnel mode) ---
  if [ "$mode" = tunnel ]; then
    b=$(body 80 example.test /website/preview/basic/)
    [[ "$b" == "site-ok host=example.test preview=[basic] "*"uri=/bn/" ]] && pass "$mode: /website/preview/basic/ reaches site with X-Site-Preview: basic" || fail "$mode: preview" "$b"
    h=$(hdrs 80 example.test /website/preview/basic/)
    grep -qi '^x-robots-tag: noindex' <<<"$h" && pass "$mode: preview is noindex" || fail "$mode: preview noindex" "$h"
  fi
}

run_mode tunnel
run_mode direct

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
