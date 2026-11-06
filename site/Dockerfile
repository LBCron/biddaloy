# syntax=docker/dockerfile:1
# Public school sites (Astro SSR). Build context: repo root.
#   docker build -f site/Dockerfile .
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base
# node:26-alpine ships neither yarn nor a working corepack (`corepack` itself is not on PATH), so
# `RUN yarn ...` fails with exit 127 ("yarn: not found") without this. Same pin as the root
# Dockerfile.
RUN npm install -g yarn@1.22.22
WORKDIR /app
# Only the manifests of the workspaces the site needs, so yarn installs nothing of server, ui,
# client-admin or landing (smaller and faster than the whole monorepo; the public image carries
# no other workspace's packages). The root Dockerfile drops workspaces the same way.
COPY package.json yarn.lock ./
COPY shared/package.json shared/package.json
COPY site-themes/package.json site-themes/package.json
COPY site/package.json site/package.json

FROM base AS build
RUN yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000
COPY tsconfig.base.json ./
COPY shared shared
COPY site-themes site-themes
COPY site site
RUN yarn workspace @biddaloy/shared build \
 && yarn workspace @biddaloy/site-themes build \
 && yarn workspace @biddaloy/site build

# Runtime packages only. yarn may nest a package under a workspace instead of the root (when a
# dev-only version of it holds the root slot: site/node_modules/send today), so each workspace's
# own node_modules is kept too; mkdir makes the COPY below work when yarn nested nothing there.
FROM base AS prod-deps
RUN yarn install --frozen-lockfile --production --ignore-scripts --network-timeout 600000 \
 && mkdir -p shared/node_modules site-themes/node_modules site/node_modules

FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/shared/node_modules ./shared/node_modules
COPY --from=prod-deps /app/site-themes/node_modules ./site-themes/node_modules
COPY --from=prod-deps /app/site/node_modules ./site/node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/site-themes/dist ./site-themes/dist
COPY --from=build /app/site-themes/package.json ./site-themes/package.json
COPY --from=build /app/site/dist ./site/dist
COPY --from=build /app/site/package.json ./site/package.json
# Build fails here, not at boot, if the bundle imports a package the runtime install lacks. (Astro
# bundles @astrojs/node into entry.mjs, which then imports `send` itself: yarn nests send@1 under
# @astrojs/node in a --production install, so site/package.json declares it.)
RUN --mount=type=bind,source=scripts/check-image-requires.cjs,target=/check.cjs \
    node /check.cjs /app/site/dist/server /app/shared/dist /app/site-themes/dist
USER node
EXPOSE 4321
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4321/healthz || exit 1
CMD ["node", "site/dist/server/entry.mjs"]
