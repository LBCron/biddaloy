#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/build-output"

echo "==> Cleaning previous build..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "==> Building shared package..."
yarn workspace @biddaloy/shared build

echo "==> Building site-themes package..."
yarn workspace @biddaloy/site-themes build

echo "==> Type-checking ui package..."
# ui has no build step of its own — it's consumed as source (see ui/README.md)
# by every client, so this is the closest thing to "building" it: catch a
# type error here rather than three times over in each client's build below.
yarn workspace @biddaloy/ui lint

echo "==> Building server..."
yarn workspace @biddaloy/server build

echo "==> Building client-admin..."
yarn workspace @biddaloy/client-admin build

# Future clients:
# echo "==> Building client-teacher..."
# yarn workspace @biddaloy/client-teacher build

echo "==> Assembling build-output..."

# Shared: copy dist + package.json (for @biddaloy/shared runtime resolution)
mkdir -p "$OUTPUT_DIR/shared"
cp -r "$ROOT_DIR/shared/dist" "$OUTPUT_DIR/shared/dist"
cp "$ROOT_DIR/shared/package.json" "$OUTPUT_DIR/shared/package.json"

# Server: copy dist + package.json + install prod deps
mkdir -p "$OUTPUT_DIR/server"
cp -r "$ROOT_DIR/server/dist" "$OUTPUT_DIR/server/dist"
cp "$ROOT_DIR/server/package.json" "$OUTPUT_DIR/server/package.json"

echo "==> Installing production dependencies for server..."
(cd "$OUTPUT_DIR/server" && yarn install --production --frozen-lockfile)

# Symlink shared package into server's node_modules so @biddaloy/shared resolves
mkdir -p "$OUTPUT_DIR/server/node_modules/@biddaloy"
ln -sfn "../../../shared" "$OUTPUT_DIR/server/node_modules/@biddaloy/shared"

# Clients: copy dist folders
for client_dir in "$ROOT_DIR"/client-*/; do
  client_name=$(basename "$client_dir")
  if [ -d "$client_dir/dist" ]; then
    echo "==> Copying $client_name static files..."
    cp -r "$client_dir/dist" "$OUTPUT_DIR/$client_name"
  fi
done

# Copy start script and env example
cp "$ROOT_DIR/scripts/start.sh" "$OUTPUT_DIR/start.sh"
chmod +x "$OUTPUT_DIR/start.sh"
cp "$ROOT_DIR/.env.example" "$OUTPUT_DIR/.env.example"

# [75.21] No source map may ship: express.static would serve a stray one.
# client-admin/vite.config.ts deletes dist/**/*.map after the Sentry upload,
# but a failed upload leaves them behind, so enforce it here too.
# (-delete implies -depth, which defeats -prune, hence the ! -path form.)
find "$OUTPUT_DIR" -type f -name '*.map' ! -path "$OUTPUT_DIR/server/node_modules/*" -print -delete

echo "==> Done! Build output is at $OUTPUT_DIR"
echo "    Deploy: zip -r deploy.zip build-output/"
echo "    Run on server: unzip deploy.zip && cp .env.example .env && ./start.sh"