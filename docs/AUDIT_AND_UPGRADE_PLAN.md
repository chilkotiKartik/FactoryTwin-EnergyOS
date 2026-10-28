# Audit and upgrade plan

Audit date: 28 Oct 2026. Scope: the whole repository (≈13k lines): domain logic, server services, auth, API routes, schema, UI shell, tests, docs and build.

## Status

Phase 1 (hardening) is done; see section 7. What changed:

- A model refit that moves expected energy by less than 0.5% reuses the stored model, so small data fixes no longer make pending recommendations stale. A material change still does, on the write path.
- Analysis updates anomalies in place (ids and review status kept), writes only changed heats, and stores a model fit only when the model changes.
- Meter ingest triggers a debounced background analysis; a settings change re-analyses and marks pending advice stale.
- Approval freshness and heat-overlap checks run inside the write transaction. Viewing a recommendation no longer writes to the database.
- Ingest body cap enforced on the stream, ingest rate limit, login timing fixed, login limits per email and per address, expired sessions pruned, HSTS, tariff periods scoped by version, four new indexes (migration `0001`).
- `error.tsx`, `loading.tsx`, `not-found.tsx`, a CI workflow, a Dockerfile and tests for all of the above (`tests/integration/hardening.test.ts`).

Still open from Phase 1: targeted revalidation instead of `revalidatePath("/", "layout")`, nonce-based CSP (S6), ingest token table (S5), audit hash chain (S9). Rate limits are in-process and trust `X-Forwarded-For`, so they need a shared store and a trusted proxy for multi-instance setups.

## 1. Where the project stood (before the fixes)

The code is in good shape for a hackathon build, and better than most production pilots:

| Check | Result |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean (strict TypeScript) |
| `pnpm test` | 66 / 66 passing (unit + integration) |
| `pnpm build` | succeeds, 21 routes |
| `pnpm audit --prod` | no known vulnerabilities |
| Test coverage (lines / branches) | **49.6% / 31%** |
| CI pipeline | **none** (no `.github/workflows`) |

Strengths to keep:

- Clean split between pure domain logic (`src/domain`) and database services (`src/server/services`).
- One tenant boundary: every service takes an `Actor` and filters by `actor.factory.id`, with permissions checked in services rather than only in the UI.
- An exact DP optimiser with an independent constraint checker, plus a test against exhaustive search.
- Input fingerprints that make a recommendation stale when its inputs change, and a unique index that blocks double approval.
- Evidence labels (MEASURED / SIMULATED / MODELLED …) carried through to exports and reports.
- Careful security basics: scrypt, hashed opaque session tokens, CSP, CSV formula-injection guard, append-only audit log.

The upgrades below are ordered by how much they matter for a **real pilot on a real furnace**, which is the stated next step.

---

## 2. Bugs and workflow problems (fix first)

### 2.1 An operator's data fix silently invalidates the supervisor's pending recommendation — HIGH

Verified with a throwaway test: an operator corrected the charge of one metered heat from 20 Sep by 10 kg. The pending recommendation for 21 Oct immediately became `STALE` and could no longer be approved.

Why: every heat edit, CSV import and recorded outcome calls `analyseFactory`, which refits the OLS model on all history. The optimiser fingerprint includes the model coefficients (`src/server/services/optimization.ts:77`), so any change to the fit changes the hash.

On a live site this means recommendations go stale throughout the shift for reasons nobody can see.

Fix options:
- **Pin the model** used for a plan: fit once per day (or on an explicit "Refit model" action) and fingerprint the `modelFitId`, not the live coefficients.
- Or apply a tolerance: treat the model as unchanged when the coefficients move less than, say, 0.5%.
- Show *why* a recommendation went stale ("model refitted after heat H04 on 20 Sep was edited by operator X").

### 2.2 Every edit re-analyses 120 days and rewrites every anomaly — HIGH (scale)

`analyseFactory` (`src/server/services/analysis.ts`) runs on each heat create/update. It:
- loads up to 120 days of 1-minute readings (≈170k rows),
- updates every heat row one at a time (line 170),
- deletes and re-inserts every anomaly with **new IDs** (line 165), so links to `/anomalies/<id>` and notification targets change on every edit,
- inserts a new `model_fits` row every time (line 148), so that table grows without limit.

The probe measured ≈0.3 s per heat save on the 30-day demo. At 120 days with real data that becomes several seconds per save, all inside the server action.

Fix: re-analyse only the affected day(s) incrementally; refit the model on a schedule; upsert anomalies on `(heat_id, rule)` (the unique index already exists) instead of delete + insert; only store a new model fit when the coefficients change.

### 2.3 Live meter data and settings changes never refresh the analysis — MEDIUM

- `POST /api/ingest` stores readings but does not trigger analysis (`src/server/services/ingest.ts:77`). In a real factory, heat kWh, holding minutes and anomalies stay empty until someone presses "Run analysis".
- `updateSettings` (`src/server/services/settings.ts:42`) changes holding kW, rated kW and melt time, all of which change trace segmentation, but stored heat metrics are not recomputed.

Fix: a small background job (debounced, per factory) that re-analyses the affected day after ingest or settings changes.

### 2.4 Checks done outside the transaction — MEDIUM

- `decideRecommendation` checks input freshness at line 104 and writes at line 111 in a separate transaction. A plan edit between the two can be approved against stale inputs.
- `validateHeat` checks for overlapping heats (`heats.ts:110`) before the insert transaction, so two tablets submitting at once can create overlapping heats.

Fix: move both checks inside the transaction (SQLite serialises writers, so `BEGIN IMMEDIATE` makes this safe).

### 2.5 Page views write to the database — LOW

`getRecommendation` (called from the recommendation page render) marks the recommendation `STALE` and writes an audit event in the viewer's name. A viewer with read-only rights ends up as the actor of a state change. Move stale marking to the write paths (plan, tariff, settings and model changes) and keep page renders read-only.

### 2.6 Smaller issues

- `loadTariffVersions` reads **every factory's** tariff periods and filters in memory (`common.ts:11`). Nothing leaks, but it breaks the "always scoped" rule and grows with tenants. Filter by version ID.
- Every server action calls `revalidatePath("/", "layout")` (`actions.ts:34`), re-rendering everything after any change. Use targeted paths or tags.
- Expired sessions are never deleted; the `sessions` table grows forever.
- No `error.tsx`, `loading.tsx` or `not-found.tsx` in `src/app`, so a thrown error shows the default Next.js error page and slow pages show nothing while loading.

---

## 3. Security hardening

| # | Issue | Where | Fix |
|---|---|---|---|
| S1 | Ingest body limit is checked only through `Content-Length`; a chunked request without that header is parsed in full by `req.json()` | `api/ingest/route.ts:10-16` | Read the body as a stream with a hard byte cap |
| S2 | Login timing reveals which emails exist: scrypt runs only when the user exists | `actions.ts:53` | Always run `verifyPassword` against a dummy hash |
| S3 | Login rate limit is an in-memory `Map`: per process, lost on restart, unbounded, per email only (no per-IP limit) | `actions.ts:43` | Store attempts in the DB (or Redis) with per-IP and per-account limits, and prune old entries |
| S4 | No rate limit on `/api/ingest` or exports | API routes | Per-token and per-user limits |
| S5 | Ingest tokens: one per meter, no expiry, no rotation history, no "last used" | `meters.ingest_token_hash` | Token table with created/last-used/revoked; also index the hash (currently a full scan) |
| S6 | CSP allows `'unsafe-inline'` scripts | `next.config.ts` | Nonce-based CSP (supported by Next.js) |
| S7 | No account management: no password change, invite, reset, deactivation or "sign out everywhere". The first owner must be created directly in the DB | — | Minimal user admin; optional SSO (Google / Microsoft) for owners |
| S8 | No HSTS header | `next.config.ts` | Add `Strict-Transport-Security` when `COOKIE_SECURE=true` |
| S9 | Audit log is append-only by convention only | `audit_events` | Hash-chain each event to the previous one so tampering is detectable — useful for savings claims |

---

## 4. Performance and scale

- **Time-zone conversion in hot loops.** `rateAt` → `localMinuteOfDay` → `Intl.DateTimeFormat.formatToParts` runs once per reading (`time.ts:39`, `energy.ts:60`). Pricing 120 days of 1-minute data means about 170k Intl calls. Cache the UTC offset per day; for fixed-offset zones like Asia/Kolkata it is constant.
- **Missing indexes:** `tariff_periods.tariff_version_id`, `meters.ingest_token_hash`, `model_fits(factory_id, created_at)`, `execution_records(factory_id, day_date)`.
- **Daily rollups.** Dashboards recompute from raw readings on every request. Add a `daily_energy` table (kWh, cost by band, tonnes, SEC, completeness) updated by the analysis job.
- **Raw data retention.** Keep 1-minute data for about 13 months, then downsample.
- **PostgreSQL / Timescale** once there is more than one site. Drizzle makes this mostly a driver and migration change, as the docs say; the per-row loops in analysis and seeding should become batch inserts first.
- **The optimiser runs on the request thread.** Fine for one furnace with 12 heats (≈40 ms). Multi-furnace or reordering versions (section 5.2) should run in a worker thread or job queue.

---

## 5. Product and domain upgrades (the big wins)

### 5.1 Real-plant connectivity — the first step to a pilot

- **Meter gateway adapters:** Modbus TCP/RTU poller (Schneider PM5xxx / EM6400, Secure Elite), MQTT subscriber, and an OPC UA client. Ship as a small edge service that buffers offline and pushes to `/api/ingest`.
- **Cumulative-register support:** most meters expose a kWh counter, not interval energy. Accept counter readings and difference them server-side, handling counter rollover and meter replacement.
- **Clock-drift handling:** snap slightly misaligned timestamps (for example ±5 s) instead of rejecting them, and record the drift.
- **Heat-log capture on the shop floor:** a PWA with offline queueing for tablets, big touch targets, and a "tap now" button that stamps the time. Manual typing of times is the largest data-quality risk.
- **Furnace panel signals (read-only):** a digital input for "power on / tap" removes the need to log start and tap times by hand.

### 5.2 Optimiser

- **Maximum demand (kVA) charges.** Indian HT industrial bills often have a large demand charge on the highest 15/30-minute kVA. The current objective ignores it. Add a demand cap or demand cost term; this is often worth as much as ToD shifting.
- **Power factor / kVAh billing.** Many states bill in kVAh, so add reactive power to the model.
- **Heat sequencing:** let the solver reorder heats within an order or grade (for example a CP-SAT / MILP model via a Python sidecar or `highs-js`), keeping the DP as the exact solver for a fixed sequence.
- **Multiple furnaces** sharing one transformer limit and one moulding line, and twin-track (tandem) furnaces.
- **Labour and shifts:** crew availability and break times as hard limits.
- **Re-optimise during the shift:** when a heat runs late or a mould is delayed, re-plan the rest of the day from "now".
- **Robustness:** penalise schedules that become infeasible if a mould is 10 minutes late, using the history of mould-readiness delays.
- **Solar and storage:** rooftop PV forecast and BESS state of charge as inputs to the price curve.

### 5.3 Expected-energy model and anomalies

- **More features:** charge mix (scrap / pig iron / returns), tap temperature (superheat), lining heat count (the model drifts as the lining wears), lid-open time if available, ambient temperature.
- **Robust regression** (Huber or RANSAC) so one bad heat does not move the baseline; a rolling window; a confidence interval on every expected value.
- **Grade-level models**, with the factory model as a prior when a grade has little history.
- **More anomaly rules:** slow melt rate (kWh per minute well below rated), extra superheat time, idle energy between heats, power-limited melts (transformer or capacitor trouble), and repeated overruns by shift or crew.
- **Drift and lining alerts:** a CUSUM on SEC residuals to detect gradual degradation (lining, coil, capacitor bank).
- **Feedback loop:** "anomaly was a real issue / false alarm" labels on resolve, used to tune thresholds per rule.

### 5.4 Measurement and verification (M&V)

- **Multi-day baselines.** A single baseline day versus a single comparison day is weak evidence. Support baseline *periods* with a regression-adjusted baseline (IPMVP Option B for the furnace sub-meter), normalised for tonnes and grade mix.
- **Uncertainty.** Report savings with a confidence interval and the ASHRAE Guideline 14 statistics (CV(RMSE), NMBE), so a buyer or BEE auditor can trust the number.
- **Non-routine adjustments:** record events such as relining, a new furnace or a tariff change and exclude or adjust for them.
- **Signed reports:** a PDF with the audit hash chain (S9) and every input fingerprint.

### 5.5 Users, alerts and reporting

- **Notifications:** WhatsApp / SMS / email for high anomalies, pending approvals near shift start, meter offline and data-quality pauses. WhatsApp is the realistic channel for foundry supervisors in India.
- **Languages:** Marathi, Hindi and Gujarati for operator screens (Kolhapur, Rajkot and Coimbatore clusters).
- **Shift handover report** generated automatically at shift end.
- **Owner view across factories:** SEC league table, savings to date and payback progress.
- **BEE / PAT and ESG exports:** monthly energy and CO₂ in the formats auditors ask for, with an updated CEA grid factor (the docs already note a newer CEA version).
- **Public API** with OpenAPI docs so ERP / MES tools can push production plans and read recommendations.

### 5.6 Commercial readiness

- Self-serve onboarding: create factory → furnace → meter → tariff (pick the state DISCOM tariff from a library) → first import.
- **Tariff library:** versioned ToD tariffs for the main state commissions (MSEDCL, GUVNL, TANGEDCO, …), marked VERIFIED with the tariff order reference.
- Usage-based plans per furnace; the per-tenant isolation is already in place.

---

## 6. Engineering and operations

- **CI (GitHub Actions):** install → lint → typecheck → unit and integration tests → build → Playwright e2e on every PR. Nothing runs automatically today.
- **Coverage:** raise from 49.6% lines / 31% branches. Untested areas include `domain/anomaly.ts`, `domain/model.ts`, `domain/simulator.ts`, `domain/time.ts` (DST paths), auth/session code and most page-level logic. Add property-based tests (fast-check) for tariff wrap-around, gap detection and the optimiser.
- **Container:** commit the Dockerfile outlined in `docs/DEPLOYMENT.md` (multi-stage, non-root user, `next build` with `output: "standalone"`), and run migrations as a separate step instead of on every container start.
- **Backups:** scheduled `sqlite3 .backup` or Litestream to object storage; document and test a restore.
- **Observability:** structured JSON logs with a request ID, OpenTelemetry traces for server actions, an error tracker (Sentry), and a richer health check (last ingest per meter, analysis lag).
- **Background jobs:** a small job runner (a DB-backed queue is enough at first) for analysis, rollups, notifications and session cleanup. Several fixes above depend on it.
- **Config validation:** parse environment variables with Zod at startup and fail fast, for example refuse `SEED_DEMO_USERS=true` together with `COOKIE_SECURE=true` in production.
- **Dependency updates:** add Renovate or Dependabot.

---

## 7. Suggested roadmap

**Phase 1 — Hardening (1–2 weeks)**
1. Pin the model per plan (2.1) and incremental analysis with anomaly upserts (2.2).
2. Move freshness and overlap checks into transactions (2.4); make page renders read-only (2.5).
3. Security S1–S5 and S8; session cleanup; missing indexes.
4. CI pipeline, `error.tsx` / `loading.tsx`, Dockerfile, backups.

**Phase 2 — Pilot-ready (3–6 weeks)**
1. Edge gateway (Modbus/MQTT) with counter-register support and offline buffering (5.1).
2. Background jobs: auto-analysis after ingest, daily rollups, notifications (2.3, 5.5).
3. Shop-floor PWA for heat logging, with Marathi/Hindi.
4. User management (S7) and a tariff library with VERIFIED state tariffs.

**Phase 3 — Differentiation (2–4 months)**
1. Maximum-demand and kVAh-aware optimiser; in-shift re-planning; heat reordering (5.2).
2. Richer energy model, drift/lining detection and anomaly feedback (5.3).
3. IPMVP-style M&V with uncertainty and signed reports (5.4).
4. PostgreSQL/Timescale, multi-furnace and multi-site owner views.
