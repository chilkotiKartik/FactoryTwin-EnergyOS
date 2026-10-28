# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Dev dependencies stay: `pnpm db:setup` runs through tsx.
RUN pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_URL=file:/data/energyos.db COOKIE_SECURE=true SEED_DEMO_USERS=false
RUN corepack enable && mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run as a separate step: docker run --rm -v energyos:/data <image> pnpm db:setup
CMD ["pnpm", "start"]
