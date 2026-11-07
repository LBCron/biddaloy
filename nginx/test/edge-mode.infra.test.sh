#!/usr/bin/env bash
# [75.5, 79.0] Behaviour test for the two edge modes (nginx/edge-mode.sh + the templates):
#   - EDGE_MODE must be tunnel or direct, or the container stops
#   - unknown Host / SNI -> nothing (444, or a rejected handshake)
#   - /healthz answers only to loopback
#   - tunnel mode: plain HTTP on :80, no TLS, no 401 anywhere
#   - direct mode: :80 redirects to HTTPS (ACME path excepted); protected hosts (kuma.,
#     staging.) want basic auth, Kuma's /api/push/ does not, the app host never does
#   - two app upstreams: with one stopped, requests still get 200 from the other
#   - `nginx -t` passes in tunnel, direct, and direct without the ops blocks
# nginx 444 = curl exit 52 (empty reply) over http, 56 over https. 35 = TLS handshake rejected.
# The test network is the public documentation range 198.51.100.0/24 on purpose: its peers
# look like real public clients. Needs docker only. Run: bash nginx/test/edge-mode.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=edgemode-test
VOL=edgemode-test-le
AUTH=edgemode-test-auth
NGINX_IMG=nginx:1.31-alpine
CURL_IMG=curlimages/curl
EDGE_IP=198.51.100.10
CLIENT_IP=198.51.100.50
FAILS=0

cleanup() {
  docker rm -f edgemode-app-a edgemode-app-b edgemode-kuma edgemode-edge edgemode-bad >/dev/null 2>&1 || true
  docker volume rm "$VOL" "$AUTH" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

# Tunnel mode requires the pinned edge subnet (EDGE_TRUSTED_CIDR); here, the test network.
TRUSTED=198.51.100.0/24
docker network create --subnet "$TRUSTED" "$NET" >/dev/null
docker volume create "$VOL" >/dev/null
docker volume create "$AUTH" >/dev/null

# stub <name> <alias> <port> <reply>
stub() {
  docker run -d --name "$1" --network "$NET" --network-alias "$2" --entrypoint sh "$NGINX_IMG" \
    -c "echo 'server { listen $3; location / { default_type text/plain; return 200 \"$4\"; } }' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null
}
stub edgemode-app-a prod-app 3000 app-a
stub edgemode-app-b prod-app2 3000 app-b
stub edgemode-kuma uptime-kuma 3001 kuma-ok

# Self-signed cert where certbot would put it, and one basic-auth user (u:p).
docker run --rm -v "$VOL:/le" --entrypoint sh alpine/openssl -c \
  'mkdir -p /le/live/example.test && openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /le/live/example.test/privkey.pem -out /le/live/example.test/fullchain.pem -subj /CN=example.test' >/dev/null 2>&1
docker run --rm -v "$AUTH:/auth" --entrypoint sh alpine/openssl -c 'echo "u:$(openssl passwd -apr1 p)" > /auth/htpasswd' >/dev/null

EDGE_ARGS=(-e APP_DOMAIN=example.test -e STAGING_DOMAIN=staging.example.test -e DEMO_DOMAIN=demo.example.test
  -e LANDING_DOMAIN=landing.example.test -e KUMA_DOMAIN=kuma.example.test -e BESZEL_DOMAIN=beszel.example.test
  -e LOGS_DOMAIN=logs.example.test
  -v "$PWD/nginx/templates:/etc/nginx/templates:ro"
  -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro"
  -v "$PWD/nginx/edge-mode.sh:/docker-entrypoint.d/15-edge-mode.sh:ro"
  -v "$VOL:/etc/letsencrypt:ro" -v "$AUTH:/etc/nginx/auth:ro")

# run_edge <mode> [ops-host] — same mounts/env as the compose `nginx` service.
run_edge() {
  docker rm -f edgemode-edge >/dev/null 2>&1 || true
  docker run -d --name edgemode-edge --network "$NET" --ip "$EDGE_IP" -e "EDGE_MODE=$1" \
    -e "OPS_UPSTREAM_HOST=${2-ops}" -e "EDGE_TRUSTED_CIDR=$TRUSTED" "${EDGE_ARGS[@]}" "$NGINX_IMG" >/dev/null
  for _ in $(seq 20); do
    docker exec edgemode-edge nc -z 127.0.0.1 80 >/dev/null 2>&1 && break
    sleep 1
  done
}

# curl_as <curl args...> -> prints "<http_code> <curl_exit>"
curl_as() {
  local rc code
  set +e
  code=$(docker run --rm --network "$NET" --ip "$CLIENT_IP" "$CURL_IMG" -s -m 5 --http1.1 \
    -o /dev/null -w '%{http_code}' "$@")
  rc=$?
  set -e
  echo "$code $rc"
}
# body_as <curl args...> -> response body ("" on failure)
body_as() { docker run --rm --network "$NET" --ip "$CLIENT_IP" "$CURL_IMG" -s -m 5 --http1.1 "$@" || true; }

# expect <label> <want "code rc"> <got "code rc">
expect() { [ "$3" = "$2" ] && pass "$1" || fail "$1" "$3 (want $2)"; }
# https <host> <path> -> curl args for a TLS request to the edge
https() { echo --resolve "$1:443:$EDGE_IP" -k "https://$1$2"; }
http() { echo --resolve "$1:80:$EDGE_IP" "http://$1$2"; }

nginx_t() { # <mode> <ops-host>
  docker run --rm --network "$NET" -e "EDGE_MODE=$1" -e "OPS_UPSTREAM_HOST=$2" -e "EDGE_TRUSTED_CIDR=$TRUSTED" "${EDGE_ARGS[@]}" "$NGINX_IMG" nginx -t >/dev/null 2>&1
}
nginx_t tunnel ops && pass "nginx -t, tunnel" || fail "nginx -t, tunnel" "non-zero"
nginx_t direct ops && pass "nginx -t, direct" || fail "nginx -t, direct" "non-zero"
nginx_t direct "" && pass "nginx -t, direct without ops" || fail "nginx -t, direct without ops" "non-zero"
nginx_t tunnel "" && pass "nginx -t, tunnel without ops" || fail "nginx -t, tunnel without ops" "non-zero"

# A long fixed host (60 characters) sits in the site-host map as an exact name; without
# map_hash_bucket_size the default 64-byte bucket would fail `nginx -t` (Epic 40, #3655).
LONG=$(printf 'a%.0s' $(seq 48)).example.test
for m in tunnel direct; do
  docker run --rm --network "$NET" -e "EDGE_MODE=$m" -e OPS_UPSTREAM_HOST= -e "EDGE_TRUSTED_CIDR=$TRUSTED" \
    "${EDGE_ARGS[@]}" -e ROOT_DOMAIN=example.test -e "LOGS_DOMAIN=$LONG" "$NGINX_IMG" nginx -t >/dev/null 2>&1 \
    && pass "nginx -t, $m, 60-character fixed host + ROOT_DOMAIN" || fail "nginx -t, $m, long fixed host" "non-zero"
done
# The compose default ROOT_DOMAIN=root.invalid means "no school sites": the gate is closed for every host.
docker run --rm -e EDGE_MODE=tunnel -e EDGE_TRUSTED_CIDR=198.51.100.0/24 -e ROOT_DOMAIN=root.invalid -e APP_DOMAIN=example.test \
  -v "$PWD/nginx/edge-mode.sh:/e.sh:ro" --entrypoint sh "$NGINX_IMG" -c 'sh /e.sh >/dev/null && cat /etc/nginx/conf.d/01-site-host.conf' 2>&1 \
  | grep -q '~\^(\[a-z0-9-\]' && fail "ROOT_DOMAIN=root.invalid opens the custom path" "regex rules present" || pass "ROOT_DOMAIN=root.invalid: gate stays closed (no regex rules)"

# A host value that could break out of the generated map (quote, semicolon, brace, newline) must stop
# the container loudly, never write a config. Same for a bad ROOT_DOMAIN.
for bad_val in 'a"b.example.test' 'a;b.example.test' 'a}b.example.test' "$(printf 'a.example.test\nb')"; do
  set +e
  out=$(docker run --rm --network "$NET" -e EDGE_MODE=tunnel -e EDGE_TRUSTED_CIDR=$TRUSTED -e ROOT_DOMAIN=example.test \
    "${EDGE_ARGS[@]}" -e "KUMA_DOMAIN=$bad_val" "$NGINX_IMG" 2>&1)
  rc=$?
  set -e
  [[ "$rc" != 0 && "$out" == *"KUMA_DOMAIN must be a host name"* ]] \
    && pass "bad fixed-host value is refused at start" || fail "bad fixed-host value $(printf %q "$bad_val")" "exit=$rc"
done
# Empty ROOT_DOMAIN: the gate has no regex rules, so no host reaches the site container.
out=$(docker run --rm -e EDGE_MODE=tunnel -e EDGE_TRUSTED_CIDR=$TRUSTED -e ROOT_DOMAIN= -e APP_DOMAIN=example.test \
  -v "$PWD/nginx/edge-mode.sh:/e.sh:ro" --entrypoint sh "$NGINX_IMG" -c 'sh /e.sh >/dev/null && cat /etc/nginx/conf.d/01-site-host.conf' 2>&1)
[[ "$out" == *"default 0;"* && "$out" != *'" 1;'* ]] \
  && pass "empty ROOT_DOMAIN: every host answers 0 (444)" || fail "empty ROOT_DOMAIN gate" "$out"

# --- a bad EDGE_MODE stops the container and says why ---
set +e
bad=$(docker run --rm --name edgemode-bad --network "$NET" -e EDGE_MODE=bogus "${EDGE_ARGS[@]}" "$NGINX_IMG" 2>&1)
code=$?
set -e
[[ "$code" != 0 && "$bad" == *"EDGE_MODE must be tunnel or direct"* ]] \
  && pass "EDGE_MODE=bogus: exits non-zero, says why" || fail "EDGE_MODE=bogus" "exit=$code $bad"

# --- tunnel mode without EDGE_TRUSTED_CIDR stops the container (never guessed, Rule 11) ---
set +e
bad=$(docker run --rm --name edgemode-bad --network "$NET" -e EDGE_MODE=tunnel "${EDGE_ARGS[@]}" "$NGINX_IMG" 2>&1)
code=$?
set -e
[[ "$code" != 0 && "$bad" == *"EDGE_TRUSTED_CIDR must be set in tunnel mode"* ]] \
  && pass "tunnel without EDGE_TRUSTED_CIDR: exits non-zero, says why" || fail "tunnel without EDGE_TRUSTED_CIDR" "exit=$code $bad"

# --- tunnel mode ---
run_edge tunnel
# shellcheck disable=SC2046
expect "tunnel: app host over plain HTTP -> 200" "200 0" "$(curl_as $(http example.test /))"
# shellcheck disable=SC2046
expect "tunnel: unknown Host -> 444" "000 52" "$(curl_as $(http evil.test /))"
# shellcheck disable=SC2046
expect "tunnel: readiness stays 404" "404 0" "$(curl_as $(http example.test /api/health/ready))"
# shellcheck disable=SC2046
expect "tunnel: kuma without credentials -> 200 (no 401)" "200 0" "$(curl_as $(http kuma.example.test /))"
# shellcheck disable=SC2046
expect "tunnel: kuma push without credentials -> 200" "200 0" "$(curl_as $(http kuma.example.test /api/push/x))"
# shellcheck disable=SC2046
expect "tunnel: staging without credentials is not 401 (staging app is down: 502)" "502 0" "$(curl_as $(http staging.example.test /))"
docker exec edgemode-edge nc -z 127.0.0.1 443 >/dev/null 2>&1 \
  && fail "tunnel: nothing listens on 443" "443 is open" || pass "tunnel: nothing listens on 443"
[ "$(docker exec edgemode-edge wget -qO- http://127.0.0.1/healthz)" = "ok" ] \
  && pass "/healthz from loopback -> ok" || fail "/healthz from loopback" "not ok"
expect "/healthz from a public peer -> 444" "000 52" "$(curl_as -H 'Host: anything' "http://$EDGE_IP/healthz")"

# --- two app upstreams: failover ---
all_ok=1
for _ in 1 2 3 4; do
  # shellcheck disable=SC2046
  [ "$(curl_as $(http example.test /api/v1/x))" = "200 0" ] || all_ok=0
done
[ "$all_ok" = 1 ] && pass "both app containers up -> 200" || fail "both app containers up" "non-200"
docker stop edgemode-app-a >/dev/null
all_b=1
for _ in 1 2 3 4 5 6; do
  # shellcheck disable=SC2046
  [ "$(body_as $(http example.test /api/v1/x))" = "app-b" ] || all_b=0
done
[ "$all_b" = 1 ] && pass "prod-app stopped: every request answered by prod-app2" || fail "failover" "a request was not served by prod-app2"
docker start edgemode-app-a >/dev/null

# --- direct mode ---
run_edge direct
expect "direct: unknown Host on 80 -> 444" "000 52" "$(curl_as -H 'Host: evil.test' "http://$EDGE_IP/")"
expect "direct: unknown SNI on 443 -> handshake rejected" "000 35" "$(curl_as --resolve "evil.test:443:$EDGE_IP" -k https://evil.test/)"
expect "direct: no SNI (bare IP) on 443 -> handshake rejected" "000 35" "$(curl_as -k "https://$EDGE_IP/")"
# shellcheck disable=SC2046
expect "direct: app host over HTTPS -> 200, no login" "200 0" "$(curl_as $(https example.test /))"
# shellcheck disable=SC2046
expect "direct: app host on 80 -> 301" "301 0" "$(curl_as $(http example.test /))"
# shellcheck disable=SC2046
expect "direct: ACME path on 80 is not redirected (file absent -> 404)" "404 0" \
  "$(curl_as $(http example.test /.well-known/acme-challenge/x))"
# shellcheck disable=SC2046
expect "direct: kuma without credentials -> 401" "401 0" "$(curl_as $(https kuma.example.test /))"
# shellcheck disable=SC2046
expect "direct: kuma with wrong credentials -> 401" "401 0" "$(curl_as -u u:wrong $(https kuma.example.test /))"
# shellcheck disable=SC2046
expect "direct: kuma with credentials -> 200" "200 0" "$(curl_as -u u:p $(https kuma.example.test /))"
# shellcheck disable=SC2046
expect "direct: kuma /api/push/x without credentials -> 200 from upstream" "200 0" \
  "$(curl_as $(https kuma.example.test /api/push/x))"
# The Let's Encrypt challenge must work on protected hosts (certbot has no login): never 401.
for h in kuma.example.test staging.example.test beszel.example.test logs.example.test; do
  # shellcheck disable=SC2046
  expect "direct: ACME path on $h (http) is not behind the login (file absent -> 404)" "404 0" \
    "$(curl_as $(http "$h" /.well-known/acme-challenge/x))"
  # shellcheck disable=SC2046
  expect "direct: ACME path on $h (https) is not behind the login" "404 0" \
    "$(curl_as $(https "$h" /.well-known/acme-challenge/x))"
done
# Only a plain /api/push/<token> skips the outer login; path tricks must not reach Kuma unauthenticated.
# shellcheck disable=SC2046
expect "direct: kuma /api/push/tok?status=up without credentials -> 200" "200 0" \
  "$(curl_as $(https kuma.example.test '/api/push/tok?status=up'))"
for trick in '/socket.io/..%2fapi/push/x' '/metrics/%2e%2e/api/push/x' '/api/push/' '/api/push/a/b'; do
  # shellcheck disable=SC2046
  got=$(curl_as --path-as-is $(https kuma.example.test "$trick"))
  case "$got" in "401 0" | "404 0") pass "direct: kuma $trick without credentials -> ${got%% *}" ;; *) fail "direct: kuma $trick" "$got" ;; esac
done
# shellcheck disable=SC2046
hsts=$(body_as -skI $(https example.test /) | tr -d '\r' | grep -i '^strict-transport-security: max-age=' || true)
[ -n "$hsts" ] && pass "direct: app host sends HSTS" || fail "direct: HSTS" "missing"
# shellcheck disable=SC2046
expect "direct: staging without credentials -> 401" "401 0" "$(curl_as $(https staging.example.test /))"
# shellcheck disable=SC2046
expect "direct: beszel without credentials -> 401" "401 0" "$(curl_as $(https beszel.example.test /))"
# shellcheck disable=SC2046
expect "direct: logs without credentials -> 401" "401 0" "$(curl_as $(https logs.example.test /))"
# shellcheck disable=SC2046
expect "direct: readiness stays 404" "404 0" "$(curl_as $(https example.test /api/health/ready))"

# --- direct mode with the ops blocks absent (ops runs on another host) ---
run_edge direct ""
# shellcheck disable=SC2046
expect "direct, no ops: kuma host is unknown -> handshake rejected" "000 35" \
  "$(curl_as $(https kuma.example.test /))"
# shellcheck disable=SC2046
expect "direct, no ops: app host still 200" "200 0" "$(curl_as $(https example.test /))"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
