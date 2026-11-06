# syntax=docker/dockerfile:1

# ---- Base ----
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base
# libc6-compat is needed by some native deps on Alpine (e.g. bcrypt)
RUN apk add --no-cache libc6-compat
# node:26-alpine ships neither yarn nor a working corepack (`corepack` itself
# is not on PATH), so every downstream `RUN yarn ...` step fails with
# "yarn: not found" without this — confirmed by building this Dockerfile
# as-is before this line existed. Pinned to match the version used
# everywhere else in this repo (yarn --version elsewhere reports 1.22.22).
RUN npm install -g yarn@1.22.22
WORKDIR /app

# ---- Dependencies (dev + prod, needed to build) ----
# Workspace package.json files must be present for `yarn install` to resolve
# the monorepo's workspaces and validate the lockfile — copying only the root
# manifest would make yarn think there are no workspace packages at all.
FROM base AS deps
COPY package.json yarn.lock ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY ui/package.json ui/package.json
COPY client-admin/package.json client-admin/package.json
# landing is not built here, but the root tsconfig references it and the PWA
# service-worker build (rolldown) follows that reference to landing/tsconfig.json,
# which extends `astro/tsconfigs/strict`. Without astro installed the client
# build fails with "Tsconfig not found astro/tsconfigs/strict".
COPY landing/package.json landing/package.json
RUN yarn install --frozen-lockfile --network-timeout 600000

# ---- Production-only dependencies ----
FROM base AS prod-deps
COPY package.json yarn.lock ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY ui/package.json ui/package.json
COPY client-admin/package.json client-admin/package.json
RUN yarn install --frozen-lockfile --production --network-timeout 600000

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app ./
COPY . .
# Sentry source maps (W2): the token is a BuildKit secret, never an ARG or layer. No token = empty =
# the vite plugin stays off and writes no maps. The plugin deletes maps after upload, so the image
# never carries one. SENTRY_RELEASE = the commit SHA = the runtime release.
ARG APP_VERSION=dev
ARG SENTRY_ORG
ARG SENTRY_PROJECT
# Vite inlines this at build time; empty = every in-app help (?) and F1 stay hidden (#3045).
ARG VITE_HANDBOOK_URL=https://schoolmanagerp.gitbook.io/schoolmanagerp-docs
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    yarn build:shared && yarn build:server \
    && export SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
       SENTRY_RELEASE="$APP_VERSION" SENTRY_ORG="$SENTRY_ORG" SENTRY_PROJECT="$SENTRY_PROJECT" \
       VITE_HANDBOOK_URL="$VITE_HANDBOOK_URL" \
    && yarn build:client-admin

# ---- Runner (production) ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# Run as an unprivileged user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 app

# node_modules includes the yarn-workspaces symlink node_modules/@biddaloy/shared
# -> ../shared, so shared/dist + shared/package.json must land at that relative
# path for the server's `@biddaloy/shared` import to resolve at runtime.
COPY --from=prod-deps --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=app:nodejs /app/shared/dist ./shared/dist
COPY --from=builder --chown=app:nodejs /app/shared/package.json ./shared/package.json
COPY --from=builder --chown=app:nodejs /app/server/dist ./server/dist
COPY --from=builder --chown=app:nodejs /app/server/package.json ./server/package.json

# Served statically at `/` by the Nest app in production — one SPA for
# every audience ([8.9.10]); see server/src/main.ts.
COPY --from=builder --chown=app:nodejs /app/client-admin/dist ./client-admin

USER app
EXPOSE 3000

CMD ["node", "server/dist/main.js"]
