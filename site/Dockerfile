# Public school sites (Astro SSR). Build context: repo root.
#   docker build -f site/Dockerfile .
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app
COPY . .
RUN yarn install --frozen-lockfile --ignore-scripts \
 && yarn workspace @biddaloy/shared build \
 && yarn workspace @biddaloy/site-themes build \
 && yarn workspace @biddaloy/site build

FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/site-themes ./site-themes
COPY --from=build /app/site/dist ./site/dist
USER node
EXPOSE 4321
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4321/healthz || exit 1
CMD ["node", "site/dist/server/entry.mjs"]
