# APlasma Admin panel — separate Nuxt app sharing the same DB as the main app.
#
# Same multi-stage layout as the main app's Dockerfile, but builds from the
# ./admin subdirectory. The built image is published as
# ghcr.io/guiguijke/nest2d-admin:latest by the CI workflow.

ARG NODE_VERSION=24.11.0

FROM node:${NODE_VERSION}-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ARG PORT=3000

WORKDIR /src

FROM base AS build

# Build context is the admin/ directory (configured in docker-compose / CI).
COPY --link package.json package-lock.json ./
RUN npm ci

COPY --link . .

RUN npm run build

FROM base

ENV PORT=$PORT
ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY --from=build /src/.output /src/.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
