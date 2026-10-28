# FactoryTwin EnergyOS

Heat-level energy intelligence for small induction foundries. Built for the **Yuva Yodha Energy Tech Hackathon 2026, Challenge 04**.

> **SIMULATION — SYNTHETIC DATA — NOT FIELD VALIDATION.** The demo factory runs on data from a deterministic scenario engine. No figure in it is a measured field result, and the app labels every number accordingly.

The product closes one loop:

```
factory data → production-energy analysis → explainable anomaly → feasible schedule
→ human review → approval / rejection → outcome recording → savings verification
```

On the deck's day it finds that Heat 07 used about 13% more energy than expected because metal held for 45 minutes waiting for mould set 7. It then proposes moving the first start from 06:00 to 08:50, which removes all 138 minutes of holding and moves melting into the cheaper solar window, with every production, mould, capacity and deadline constraint checked. A supervisor approves or rejects the proposal; the outcome is recorded and verified per tonne.

EnergyOS is **advisory only**. It never sends a command to a furnace or any other equipment.

## Quick start

Requirements: Node.js 20.9+ (tested on 22), pnpm 10.

```bash
pnpm install
cp .env.example .env
pnpm db:setup        # creates ./data/energyos.db and seeds the demo (≈4 s)
pnpm dev             # http://localhost:3000
```

Sign in with any demo account (password `energyos-demo`, set by `DEMO_PASSWORD`):

| Account | Role | Can |
|---|---|---|
| `owner@foundry-a.test` | Owner | everything; also a member of Foundry B |
| `supervisor@foundry-a.test` | Supervisor | run analysis and the optimiser, approve/reject, record outcomes, load scenarios |
| `analyst@foundry-a.test` | Analyst | import data, edit tariffs and plans, run the optimiser, verify; **cannot approve** |
| `operator@foundry-a.test` | Operator | view, log and edit heats |
| `owner@foundry-b.test` | Owner of Foundry B | an empty real (non-simulation) factory, used to show tenant isolation and LIVE/OFFLINE modes |

`pnpm db:reset` deletes and recreates the database. Inside the app, **Scenario control** reloads any of the five scenarios without touching users, other factories or the audit log.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm test` | Unit and integration tests (Vitest); each integration file uses its own temporary database |
| `pnpm test:e2e` | Playwright demo flow against a production build on port 3100 with `data/e2e.db`. Run `pnpm build` first. If Playwright's own Chromium is not installed, set `PLAYWRIGHT_CHROMIUM_PATH` to a Chromium binary. |
| `pnpm db:setup` | Apply migrations and seed if empty |
| `pnpm db:reset` | Recreate the database |
| `pnpm db:generate` | Generate a migration after editing `src/db/schema.ts` |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./data/energyos.db` | libSQL/SQLite URL |
| `SEED_DEMO_USERS` | `true` | Seed demo logins. Set `false` for any shared deployment. |
| `DEMO_PASSWORD` | `energyos-demo` | Password for seeded demo accounts |
| `COOKIE_SECURE` | `false` | `true` when served over HTTPS (also enables HSTS) |
| `ANALYSIS_DEBOUNCE_MS` | `60000` | Delay before re-analysing a factory after new meter data arrives through the ingest API |
| `ALLOW_PRIVATE_WEBHOOKS` | `false` | Allow alert webhooks to private hosts or plain HTTP (an internal SMS/WhatsApp gateway) |
| `ENERGYOS_JOBS` | `true` | `false` turns off the background jobs (audit sealing, meter-offline alerts, session cleanup) |

The server refuses to start with `COOKIE_SECURE=true`, demo users and the default demo password.

No secret is ever sent to the browser. Sessions are random opaque tokens stored only as SHA-256 hashes; passwords are scrypt hashes; meter ingest tokens are shown once and stored hashed.

## Screens

Dashboard (decision loop, KPIs with definitions, power trace with tariff windows, SEC by heat, trends) · Heat log (filters, tablet quick entry, edit with revision check) · Heat detail (expected vs actual, trace, findings, evidence level) · Meter data (quality, gaps, unlinked energy, CSV preview → commit, readings) · Anomalies · Schedule optimiser (plan inputs, Gantt current vs recommended, constraint checks, infeasibility explanation, run history) · Approvals · Verification (baseline vs comparison per tonne, payback, avoided CO₂, printable reports) · Tariffs (versioned) · Reports & exports (CSV with metadata, printable daily report) · Audit log · Evidence & assumptions · Factory settings (process parameters, team, meter ingest token) · Scenario control.

## API

- `GET /api/health` — database check.
- `GET /api/export/{heats|readings|anomalies|recommendations|audit}?from=YYYY-MM-DD&to=YYYY-MM-DD` — CSV for the signed-in user's active factory (max 31 days).
- `POST /api/ingest` — read-only meter intake. `Authorization: Bearer eos_…` (issued in Factory settings), body `{"readings":[{"timestamp":"2026-10-22T09:00:00+05:30","power_kw":512.4,"energy_kwh":8.54}]}`. Meters that only expose a cumulative register can send `"energy_kwh_total"` instead; interval energy is the difference to the next interval, and a counter that goes backwards (reset, rollover) is detected. Timestamps up to 5 s off the interval grid are snapped (clock drift). Stored as MEASURED. Refused for simulation factories. Max 512 KB, 120 requests/min per token.

Alerts (new high anomaly, recommendation awaiting a decision, advice paused, meter offline, energy drift) appear in Settings and are POSTed as JSON to the factory's webhook with `X-EnergyOS-Timestamp` and `X-EnergyOS-Signature: sha256=HMAC(secret, "timestamp.body")`.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — structure, data model, algorithms, security
- [docs/ASSUMPTIONS_AND_LIMITATIONS.md](docs/ASSUMPTIONS_AND_LIMITATIONS.md) — what is assumed, what is not claimed, sources
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — three-minute demo
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — running it on a server
