#!/usr/bin/env bash
# [75.23] nginx access log must never hold a secret-link token: no query
# string, no Referer, no path token, including on the catch-all servers.
# Same harness as real-ip.infra.test.sh (tunnel mode, plain HTTP). Needs docker only.
#   bash nginx/test/access-log.infra.test.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=accesslog-test
NGINX_IMG=nginx:1.31-alpine
CURL_IMG=curlimages/curl
EDGE_IP=172.30.96.10
FAILS=0

cleanup() {
  docker rm -f accesslog-upstream accesslog-edge >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1 (got: $2)"; FAILS=$((FAILS + 1)); }

docker network create --subnet 172.30.96.0/24 "$NET" >/dev/null

UP_CONF='server { listen 3000; location / { default_type text/plain; return 200 "ok"; } }'
docker run -d --name accesslog-upstream --network "$NET" --network-alias prod-app \
  --entrypoint sh "$NGINX_IMG" \
  -c "echo '$UP_CONF' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'" >/dev/null

docker run -d --name accesslog-edge --network "$NET" --ip "$EDGE_IP" \
  -e EDGE_MODE=tunnel -e EDGE_TRUSTED_CIDR=172.30.96.0/24 -e APP_DOMAIN=example.test -e OPS_UPSTREAM_HOST= \
  -v "$PWD/nginx/templates:/etc/nginx/templates:ro" \
  -v "$PWD/nginx/reload-loop.sh:/docker-entrypoint.d/99-reload-loop.sh:ro" \
  -v "$PWD/nginx/edge-mode.sh:/docker-entrypoint.d/15-edge-mode.sh:ro" \
  "$NGINX_IMG" >/dev/null
for _ in $(seq 20); do
  docker exec accesslog-edge nc -z 127.0.0.1 80 >/dev/null 2>&1 && break
  sleep 1
done

docker exec accesslog-edge nginx -t >/dev/null 2>&1 && pass "nginx -t" || fail "nginx -t" "non-zero"

# One request per secret-bearing shape, each with a secret Referer.
for path in '/reset-password?token=SECRET1' '/api/v1/public/verify/SECRET2' \
  '/api/v1/calendar/feed/SECRET3.ics' '/i/SECRET4' '/v/SECRET5' \
  '/api/v1/public/invoices/SECRET6' '/api/v1/public/notices/SECRET11' '/n/SECRET12' '/api/push/SECRET10?status=up'; do
  docker run --rm --network "$NET" "$CURL_IMG" -s -o /dev/null \
    --resolve "example.test:80:$EDGE_IP" -H 'Referer: https://x/?token=SECRET7' \
    "http://example.test$path"
done
# Unknown Host on the catch-all server (plain HTTP gets 444).
docker run --rm --network "$NET" "$CURL_IMG" -s -o /dev/null -H 'Host: other.test' \
  "http://$EDGE_IP/api/v1/public/verify/SECRET8?token=SECRET9" || true
sleep 1

logs=$(docker logs accesslog-edge 2>&1)
count=$(grep -c SECRET <<<"$logs" || true)
[ "$count" = 0 ] && pass "no SECRET in the log" || fail "log leaks a secret" "$(grep SECRET <<<"$logs")"
[[ "$logs" == *'/reset-password"'* || "$logs" == *'/reset-password '* ]] \
  && pass "path kept, query dropped" || fail "reset-password path missing" "$logs"
[[ "$logs" == *'/api/v1/public/verify/[REDACTED]'* ]] \
  && pass "path token masked" || fail "verify token not masked" "$logs"
[[ "$logs" == *'/i/[REDACTED]'* && "$logs" == *'/v/[REDACTED]'* ]] \
  && pass "SPA tokens masked" || fail "SPA tokens not masked" "$logs"
[[ "$logs" == *'/api/v1/public/notices/[REDACTED]'* && "$logs" == *'/n/[REDACTED]'* ]] \
  && pass "notice link tokens masked" || fail "notice link tokens not masked" "$logs"
[[ "$logs" == *'/api/push/[REDACTED]'* ]] \
  && pass "Kuma push token masked" || fail "Kuma push token not masked" "$logs"

[ "$FAILS" = 0 ] || { echo "$FAILS check(s) failed"; exit 1; }
echo "all checks passed"
