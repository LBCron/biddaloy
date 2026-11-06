#!/usr/bin/env bash
# Writes the five first-time secret files (infra/secrets/{edge,ops,prod,staging,demo}.enc.env)
# for a NEW installation. It refuses when any of them exists; to reuse committed files on another
# VPS, grant the new host key instead (walkthrough step 8, path A). Walkthrough: docs/architecture/31-vps-deploy-walkthrough.md, step 8.
#
# - Public values come from the environment variables below (no defaults: a missing one stops).
# - Random secrets (DB passwords, JWT, encryption keys, the backup age pair, the staging and
#   Dozzle passwords) are made here and piped straight into sops: nothing is printed and no
#   plaintext touches disk.
# - Values that come from your accounts are written as FILL_ME; set them afterwards with
#   `sops set` (the walkthrough has a one-line helper). Deploys refuse to work with FILL_ME left.
# - Empty keys are left out on purpose: sops keeps an empty value in plain text, which
#   scripts/check-tracked-files.mjs refuses. Add keys later with `sops set`.
#
# Example:
#   DOMAIN=schoolmanagerp.com TUNNEL_ID=87fa4f76-... CF_ACCESS_TEAM=old-fire-0768 \
#   CF_ACCESS_AUD_STAGING=7433... CF_ACCESS_AUD_OPS=3ebd... R2_ACCOUNT_ID=c1a4... \
#   TURNSTILE_SITE_KEY_PROD=0x4AAA... TURNSTILE_SITE_KEY_DEMO=0x4AAA... GHCR_PULL_USER=tareq89 \
#   bash scripts/bootstrap-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."

for v in DOMAIN TUNNEL_ID CF_ACCESS_TEAM CF_ACCESS_AUD_STAGING CF_ACCESS_AUD_OPS R2_ACCOUNT_ID \
  TURNSTILE_SITE_KEY_PROD TURNSTILE_SITE_KEY_DEMO GHCR_PULL_USER; do
  [ -n "${!v:-}" ] || { echo "FAILED: $v is not set (see the example at the top of this file)" >&2; exit 2; }
done
: "${SOPS_AGE_KEY_FILE:?FAILED: export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt}"
grep -q REPLACE_WITH_ .sops.yaml && { echo "FAILED: put the three age public keys into .sops.yaml first" >&2; exit 2; }
creds=~/.cloudflared/$TUNNEL_ID.json
[ -f "$creds" ] || { echo "FAILED: $creds not found (cloudflared tunnel create)" >&2; exit 2; }
for f in edge ops prod staging demo; do
  [ -e "infra/secrets/$f.enc.env" ] && {
    echo "FAILED: infra/secrets/$f.enc.env exists; this script never overwrites credentials." >&2
    echo "  Same installation, new host key: do not run this script; grant the key with 'sops updatekeys'" >&2
    echo "  (walkthrough step 8, path A). A brand-new installation: move the five files away yourself first" >&2
    echo "  (path B); every secret is then new and the old deployment's values stop matching." >&2
    exit 2
  }
done
for t in sops age-keygen htpasswd openssl jq; do command -v "$t" >/dev/null || { echo "FAILED: $t not installed" >&2; exit 2; }; done

R2_BUCKET=${R2_BUCKET:-biddaloy-backups}
R2_ENDPOINT=https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
hex() { openssl rand -hex "$1"; }
b64key() { openssl rand -base64 32; }
# The app accepts $2a/$2b/$2y; $2b is what its own hashPassword writes (Rule 9).
# The password goes in on stdin (-i), never as an argument another local user could see in `ps`.
bcrypt_b() { printf '%s' "$1" | htpasswd -inBC 12 "" | tr -d ':\n' | sed 's/^\$2y\$/$2b$/'; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
age-keygen -o "$tmp/backup" 2>/dev/null
BACKUP_PUB=$(age-keygen -y "$tmp/backup")
BACKUP_PRIV=$(grep '^AGE-SECRET-KEY-' "$tmp/backup")
STAGING_PW=$(hex 16)
STAGING_HASH_B64=$(bcrypt_b "$STAGING_PW" | base64 | tr -d '\n')
DOZZLE_PW=$(hex 12)
DOZZLE_HASH=$(printf '%s' "$DOZZLE_PW" | htpasswd -inBC 12 owner | cut -d: -f2 | sed 's/^\$2y\$/$2a$/' | tr -d '\n')
TUNNEL_JSON=$(jq -c . "$creds")
# Placeholder: registration adds a random suffix to the slug. Replace it with the real one
# after registering the Smoke Test School (walkthrough Part 12c step 4).
SMOKE_SLUG=smoke-test-school

enc() { # <stack>, dotenv on stdin
  local out="infra/secrets/$1.enc.env"
  grep -vE '^[A-Za-z_][A-Za-z0-9_]*=$' | sops -e --input-type dotenv --output-type dotenv --filename-override "$out" /dev/stdin >"$out"
  echo "wrote $out ($(sops -d "$out" | grep -c =) keys, FILL_ME: $(sops -d "$out" | grep -c '=FILL_ME$'))"
}

enc edge <<EOF
EDGE_MODE=tunnel
APP_DOMAIN=app.$DOMAIN
STAGING_DOMAIN=staging.$DOMAIN
DEMO_DOMAIN=demo.$DOMAIN
INBOX_DEMO_DOMAIN=inbox-demo.$DOMAIN
INBOX_STAGING_DOMAIN=inbox-staging.$DOMAIN
LANDING_DOMAIN=$DOMAIN
KUMA_DOMAIN=kuma.$DOMAIN
BESZEL_DOMAIN=beszel.$DOMAIN
LOGS_DOMAIN=logs.$DOMAIN
ROOT_DOMAIN=$DOMAIN
OPS_UPSTREAM_HOST=uptime-kuma
CLOUDFLARE_TUNNEL_ID=$TUNNEL_ID
CLOUDFLARE_TUNNEL_CREDENTIALS_JSON=$TUNNEL_JSON
CF_ACCESS_TEAM=$CF_ACCESS_TEAM
CF_ACCESS_AUD_STAGING=$CF_ACCESS_AUD_STAGING
CF_ACCESS_AUD_OPS=$CF_ACCESS_AUD_OPS
GHCR_PULL_USER=$GHCR_PULL_USER
GHCR_PULL_TOKEN=FILL_ME
EOF

enc ops <<EOF
DOZZLE_USERS_YML=users:\n  owner:\n    name: Owner\n    email: owner@$DOMAIN\n    password: '$DOZZLE_HASH'
DOZZLE_OWNER_PASSWORD=$DOZZLE_PW
EOF

enc prod <<EOF
ENV_NAME=prod
COMPOSE_PROFILES=replica,backup
APP_MEM=1200m
PG_MEM=2g
REDIS_MEM=256m
S3_MEM=512m
APP_BASE_URL=https://app.$DOMAIN
PUBLIC_APP_URL=https://app.$DOMAIN
ROOT_DOMAIN=$DOMAIN
CORS_ORIGINS=https://app.$DOMAIN
POSTGRES_USER=biddaloy
POSTGRES_DB=biddaloy
POSTGRES_PASSWORD=$(hex 32)
S3_BUCKET=biddaloy
S3_ACCESS_KEY_ID=$(hex 16)
S3_SECRET_ACCESS_KEY=$(hex 32)
JWT_SECRET=$(hex 32)
SETTINGS_ENCRYPTION_KEY=$(b64key)
HEALTH_TOKEN=$(hex 32)
BACKUP_AGE_PUBLIC_KEY=$BACKUP_PUB
BACKUP_S3_ENDPOINT=$R2_ENDPOINT
BACKUP_S3_BUCKET=$R2_BUCKET
BACKUP_S3_ACCESS_KEY_ID=FILL_ME
BACKUP_S3_SECRET_ACCESS_KEY=FILL_ME
BACKUP_RCLONE_CRYPT_PASSWORD=$(hex 32)
BACKUP_RCLONE_CRYPT_SALT=$(hex 32)
TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY_PROD
TURNSTILE_SECRET_KEY=FILL_ME
SENTRY_TRACES_SAMPLE_RATE=0.1
SMOKE_SCHOOL_SLUG=$SMOKE_SLUG
SMOKE_ADMIN_EMAIL=smoke-admin@$DOMAIN
SMOKE_ADMIN_PASSWORD=Smk-$(hex 12)
SMOKE_TEACHER_EMAIL=smoke-teacher@$DOMAIN
SMOKE_TEACHER_PASSWORD=Smk-$(hex 12)
SMOKE_SUPER_ADMIN_EMAIL=smoke-super@$DOMAIN
SMOKE_SUPER_ADMIN_PASSWORD=Smk-$(hex 12)
EOF

enc staging <<EOF
ENV_NAME=staging
DEMO_MODE=false
APP_MEM=768m
PG_MEM=1g
REDIS_MEM=128m
S3_MEM=256m
COMPOSE_PROFILES=sink
MESSAGE_SINK=mailpit
MESSAGE_SINK_PUBLIC_URL=https://inbox-staging.$DOMAIN
APP_BASE_URL=https://staging.$DOMAIN
PUBLIC_APP_URL=https://staging.$DOMAIN
ROOT_DOMAIN=$DOMAIN
CORS_ORIGINS=https://staging.$DOMAIN
POSTGRES_USER=biddaloy
POSTGRES_DB=biddaloy_staging
POSTGRES_PASSWORD=$(hex 32)
S3_BUCKET=biddaloy-staging
S3_ACCESS_KEY_ID=$(hex 16)
S3_SECRET_ACCESS_KEY=$(hex 32)
JWT_SECRET=$(hex 32)
SETTINGS_ENCRYPTION_KEY=$(b64key)
HEALTH_TOKEN=$(hex 32)
STAGING_PASSWORD=$STAGING_PW
STAGING_PASSWORD_HASH_B64=$STAGING_HASH_B64
BACKUP_AGE_PUBLIC_KEY=$BACKUP_PUB
BACKUP_AGE_PRIVATE_KEY=$BACKUP_PRIV
BACKUP_S3_ENDPOINT=$R2_ENDPOINT
BACKUP_S3_BUCKET=$R2_BUCKET
BACKUP_S3_ACCESS_KEY_ID=FILL_ME
BACKUP_S3_SECRET_ACCESS_KEY=FILL_ME
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SENTRY_TRACES_SAMPLE_RATE=0.1
SMOKE_SCHOOL_SLUG=$SMOKE_SLUG
SMOKE_ADMIN_EMAIL=smoke-admin@$DOMAIN
SMOKE_ADMIN_PASSWORD=$STAGING_PW
SMOKE_TEACHER_EMAIL=smoke-teacher@$DOMAIN
SMOKE_TEACHER_PASSWORD=$STAGING_PW
SMOKE_SUPER_ADMIN_EMAIL=smoke-super@$DOMAIN
SMOKE_SUPER_ADMIN_PASSWORD=$STAGING_PW
EOF

enc demo <<EOF
ENV_NAME=demo
DEMO_MODE=true
APP_MEM=768m
PG_MEM=1g
REDIS_MEM=128m
S3_MEM=256m
COMPOSE_PROFILES=sink
MESSAGE_SINK=mailpit
MESSAGE_SINK_PUBLIC_URL=https://inbox-demo.$DOMAIN
APP_BASE_URL=https://demo.$DOMAIN
PUBLIC_APP_URL=https://demo.$DOMAIN
ROOT_DOMAIN=$DOMAIN
CORS_ORIGINS=https://demo.$DOMAIN
POSTGRES_USER=biddaloy
POSTGRES_DB=biddaloy_demo
POSTGRES_PASSWORD=$(hex 32)
S3_BUCKET=biddaloy-demo
S3_ACCESS_KEY_ID=$(hex 16)
S3_SECRET_ACCESS_KEY=$(hex 32)
JWT_SECRET=$(hex 32)
SETTINGS_ENCRYPTION_KEY=$(b64key)
HEALTH_TOKEN=$(hex 32)
DEMO_PASSWORD=Demo-$(hex 4)
DEMO_SKIP_SWEEP=true
TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY_DEMO
TURNSTILE_SECRET_KEY=FILL_ME
SENTRY_TRACES_SAMPLE_RATE=0.1
EOF

echo "Next: fill every FILL_ME (walkthrough step 8b), then commit .sops.yaml and infra/secrets/*.enc.env."
