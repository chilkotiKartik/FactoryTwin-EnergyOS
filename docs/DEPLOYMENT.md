# Deployment

EnergyOS is a standard Next.js Node server with a SQLite file. It needs a persistent disk, so use a VM or a host with a persistent disk (serverless platforms with an ephemeral filesystem are not suitable unless `DATABASE_URL` points to a hosted libSQL/Turso database).

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

## Process manager

Run the production server under a process manager so it restarts on failure, for example systemd or pm2:

```bash
pm2 start "pnpm start" --name energyos
```

Background analysis after meter ingest runs inside the server process, so run a single instance (or move the job to a shared queue first).

## Hosted database (libSQL / Turso)

Set `DATABASE_URL="libsql://<db>-<org>.turso.io"` and `DATABASE_AUTH_TOKEN`, then run `pnpm db:setup` once per release. The app does not set SQLite pragmas (WAL, foreign keys, busy timeout) on a hosted database; it uses the database's own. This path is configuration only and has not been exercised against a live hosted instance.

A hosted database does not make a serverless host suitable by itself: the debounced analysis after ingest, the audit-sealing and meter-health timers, and the in-memory rate limiters all assume one long-running Node process. On a serverless platform they run unreliably or per instance. The server prints a warning at start-up if it detects one.

## Capacity

Measured on the demo scenario replicated to about 124 days (178,560 one-minute readings), local SQLite, median of 5 runs: 30-day trend 16 ms, whole-range trend 66 ms, one-day summary 27 ms, one-day trace 11 ms, seven-day summary 131 ms. Dashboards read raw readings directly; there is no rollup table because nothing here needs one yet, and a cache would add staleness risk after edits, imports and tariff changes. Reconsider when a seven-day summary passes about half a second (roughly a year of one-minute data from several meters) or when several sites share one database.

## Operations

- Health check: `GET /api/health`.
- Backups: copy the SQLite file (with `-wal`) while the app is stopped, or use `sqlite3 energyos.db ".backup backup.db"`.
- Schema changes: edit `src/db/schema.ts`, run `pnpm db:generate`, commit the migration; `pnpm db:setup` applies it.
- Meter connection: Factory settings → issue an ingest token → configure the gateway to `POST /api/ingest`. The endpoint only receives data.
