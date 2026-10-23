# Deployment

EnergyOS is a standard Next.js Node server with a SQLite file. It needs a persistent disk, so use a VM, container host or PaaS with a volume (serverless platforms with an ephemeral filesystem are not suitable unless `DATABASE_URL` points to a hosted libSQL/Turso database).

## Single server

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# edit .env: DATABASE_URL to a path on the persistent volume,
# SEED_DEMO_USERS="false" for anything beyond a demo, COOKIE_SECURE="true" behind HTTPS
pnpm db:setup
pnpm build
pnpm start            # listens on :3000; put it behind a TLS reverse proxy (nginx, Caddy)
```

With `SEED_DEMO_USERS="false"` no logins are created; create the first owner account directly in the database or re-enable demo seeding on a private instance.

## Container (outline)

```dockerfile
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV DATABASE_URL=file:/data/energyos.db COOKIE_SECURE=true SEED_DEMO_USERS=false
VOLUME /data
CMD ["sh", "-c", "pnpm db:setup && pnpm start"]
```

## Operations

- Health check: `GET /api/health`.
- Backups: copy the SQLite file (with `-wal`) while the app is stopped, or use `sqlite3 energyos.db ".backup backup.db"`.
- Schema changes: edit `src/db/schema.ts`, run `pnpm db:generate`, commit the migration; `pnpm db:setup` applies it.
- Meter connection: Factory settings → issue an ingest token → configure the gateway to `POST /api/ingest`. The endpoint only receives data.
