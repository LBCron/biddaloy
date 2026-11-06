#!/bin/sh
# Mounted into /docker-entrypoint.d/ as 15-edge-mode.sh, so nginx's stock
# entrypoint runs it before 20-envsubst-on-templates.sh (and before nginx).
#
# Reads EDGE_MODE and writes the parts of the config that differ between the two
# ways the origin can be reached (Epic 79.0, D8):
#
#   tunnel  cloudflared dials in over the `biddaloy-edge` network, plain HTTP on :80.
#           The visitor address comes from CF-Connecting-IP, but only from the trusted
#           subnet EDGE_TRUSTED_CIDR (required, pinned by the deploy); no TLS lines, no basic auth
#           (Cloudflare Access is the outer login, checked by cloudflared). The app is told
#           the public scheme is https.
#   direct  80/443 are published. Let's Encrypt certificate, :80 only answers ACME and
#           redirects, the visitor address is the TCP peer (no real_ip lines at all),
#           protected hosts ask for basic auth ($basic_auth), HSTS on.
#
# Output (the templates include/read these):
#   conf.d/00-edge.conf               $basic_auth, $edge_redirect, $edge_proto, $edge_hsts,
#                                     resolver (+ real_ip in tunnel)
#   snippets/edge-server.conf         inside every named server: TLS listen + ACME + :80 redirect
#   snippets/edge-default.conf        inside the catch-all server: TLS handshake reject
#
# Any bad value stops the container: a loud failure beats a silently wrong trust model.
set -eu

ROOT="${EDGE_CONF_ROOT:-/etc/nginx}"
MODE="${EDGE_MODE:-}"

die() {
  echo "edge-mode.sh: $*" >&2
  exit 1
}

case "$MODE" in
tunnel | direct) ;;
*) die "EDGE_MODE must be tunnel or direct (got '$MODE')" ;;
esac

mkdir -p "$ROOT/conf.d" "$ROOT/snippets"
CONF="$ROOT/conf.d/00-edge.conf"
SERVER="$ROOT/snippets/edge-server.conf"
DEFAULT="$ROOT/snippets/edge-default.conf"

# Docker's embedded DNS: upstreams with `resolve` re-look-up their names, so nginx boots
# when a container (staging, the second app, ops) is not up yet.
RESOLVER='resolver 127.0.0.11 valid=10s ipv6=off;'

if [ "$MODE" = tunnel ]; then
  # Required, never detected (Rule 11): cloudflared starts after nginx is healthy, so it cannot
  # be looked up here, and guessing an interface could trust the wrong network. A wrong subnet
  # gives every visitor cloudflared's address, so one abuser's login throttle locks out everyone.
  subnet="${EDGE_TRUSTED_CIDR:-}"
  [ -n "$subnet" ] || die "EDGE_TRUSTED_CIDR must be set in tunnel mode (the pinned biddaloy-edge subnet)"
  case "$subnet" in
  *[!0-9./]*) die "invalid EDGE_TRUSTED_CIDR '$subnet'" ;;
  esac
  printf '%s\n' "$subnet" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' ||
    die "invalid EDGE_TRUSTED_CIDR '$subnet'"
  cat >"$CONF" <<EOF
# Written by edge-mode.sh (EDGE_MODE=tunnel). Do not edit.
$RESOLVER
set_real_ip_from $subnet;
real_ip_header CF-Connecting-IP;
map \$host \$basic_auth { default off; }
map \$host \$edge_redirect { default 0; }
# cloudflared talks plain HTTP to us, but visitors use https: the app must see https.
map \$host \$edge_proto { default https; }
map \$host \$edge_hsts { default ""; }
EOF
  echo "# EDGE_MODE=tunnel: plain HTTP on :80, nothing to add." >"$SERVER"
  echo "# EDGE_MODE=tunnel: nothing to add." >"$DEFAULT"
else
  domain="${APP_DOMAIN:-}"
  case "$domain" in
  '' | *[!A-Za-z0-9.-]* | .* | *. | -*) die "APP_DOMAIN must be set to a host name in direct mode (got '$domain')" ;;
  esac
  cat >"$CONF" <<EOF
# Written by edge-mode.sh (EDGE_MODE=direct). Do not edit.
$RESOLVER
map \$host \$basic_auth { default "restricted"; }
# Plain HTTP is redirected to HTTPS, except the Let's Encrypt HTTP-01 challenge.
map "\$scheme:\$uri" \$edge_redirect {
    default 0;
    "~^http:/\.well-known/acme-challenge/" 0;
    "~^http:" 1;
}
map \$scheme \$edge_proto { default \$scheme; }
map \$scheme \$edge_hsts { default ""; https "max-age=31536000"; }
EOF
  cat >"$SERVER" <<EOF
# Written by edge-mode.sh (EDGE_MODE=direct). Do not edit.
listen 443 ssl;
http2 on;
ssl_certificate     /etc/letsencrypt/live/$domain/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
# auth_basic off: the challenge must work on protected hosts too (certbot has no login).
location ^~ /.well-known/acme-challenge/ { auth_basic off; root /var/www/acme; }
if (\$edge_redirect) { return 301 https://\$host\$request_uri; }
EOF
  cat >"$DEFAULT" <<EOF
# Written by edge-mode.sh (EDGE_MODE=direct). Do not edit.
listen 443 ssl default_server;
ssl_reject_handshake on;   # nginx >= 1.19.4; no certificate needed
EOF
fi

# School-site host name (Epic 40, site.conf.template): one label of 3-30 characters (the same
# shape as SITE_SUBDOMAIN_RE in shared/src/types/site.ts) under ROOT_DOMAIN, dots escaped so
# `rumsc.schoolsXtest` never matches `schools.test`. Built here because the template's envsubst
# cannot escape a value. Unset ROOT_DOMAIN (an edge with no school sites) = `.invalid`, never resolves.
# Example: ROOT_DOMAIN=schools.test -> server_name "~^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\.schools\.test$";
site_root=$(printf '%s' "${ROOT_DOMAIN:-root.invalid}" | tr 'A-Z' 'a-z')
case "$site_root" in
  '' | *[!a-z0-9.-]* | .* | *. | -*) die "ROOT_DOMAIN must be a host name (got '$site_root')" ;;
esac
site_root_re=$(printf '%s' "$site_root" | sed 's/\./\\./g')
{
  echo '# Written by edge-mode.sh from ROOT_DOMAIN. Do not edit.'
  printf 'server_name "~^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]\\.%s$";\n' "$site_root_re"
} >"$ROOT/snippets/site-server-name.conf"

# Ops-less hosts (OPS_UPSTREAM_HOST empty): conf.d/ops.conf is removed by reload-loop.sh,
# which runs after the templates are rendered; this script runs before.
echo "edge-mode.sh: wrote $CONF (EDGE_MODE=$MODE)"
