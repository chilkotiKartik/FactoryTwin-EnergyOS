# Architecture

## Stack

Next.js 16 (App Router, React 19 server components and server actions) · TypeScript strict · Tailwind CSS v4 · Motion · Recharts and hand-built SVG charts · Drizzle ORM on libSQL/SQLite · Zod validation · Vitest · Playwright.

SQLite keeps setup to one command and suits a single-site pilot. The schema is plain Drizzle, so moving to PostgreSQL is a driver and migration change, not a redesign.

## Layout

```
src/
  domain/      Pure, framework-free logic. Fully unit tested.
    energy.ts      SEC, variance, cost by tariff interval, holding, emissions, savings, payback
    tariff.ts      versioned time-of-day tariffs, window rules, per-minute price table
    quality.ts     reading validation, gaps, duplicates, completeness, freshness, linking energy to heats
    model.ts       expected-energy model (OLS with physics prior fallback)
    anomaly.ts     trace segmentation and explainable anomaly findings
    optimizer.ts   exact dynamic-programming scheduler + independent constraint checker
    simulator.ts   deterministic furnace/day simulator (seeded PRNG)
    scenarios.ts   the five demo scenarios and deck reference figures
    evidence.ts    evidence labels, provenance rules, sources
  db/          Drizzle schema, client, migrations runner
  server/      Everything that touches the database
    context.ts     Actor (user + role + active factory) — the tenant boundary
    permissions.ts role → permission matrix (checked on every service call)
    services/      one module per area; every function takes (db, actor, …)
    auth/          scrypt passwords, opaque session tokens
  app/         Routes. Pages are server components; mutations are server actions in app/actions.ts
  components/  UI (shell, charts, forms)
drizzle/       SQL migrations
scripts/       db-setup (migrate + seed)
tests/         unit, integration (temp DB per file), e2e (Playwright)
```

## Data model (main tables)

`organizations → factories → furnaces, meters` · `users ↔ memberships(role)` · `sessions` · `heats` (times, kg, mould set, metered/manual/expected kWh, holding, completeness, provenance, revision) · `meter_readings` (unique meter+timestamp, quality, provenance, import batch) · `import_batches` · `tariff_versions → tariff_periods` · `model_fits` · `anomalies` (unique heat+rule, findings JSON, status) · `production_plans → production_orders, planned_heats` · `mould_events` · `optimization_runs` (input snapshot + hash, result) · `schedule_versions → schedule_items` · `recommendations` (version, status, input hash, predicted) · `approvals` (unique per recommendation) · `execution_records` · `verification_reports` · `energy_baselines` · `audit_events` · `simulation_scenarios`.

Timestamps are UTC epoch ms; money is integer paise; the factory time zone (Asia/Kolkata) is applied at the edges.

## Calculations

- **SEC** = metered furnace kWh ÷ poured tonnes.
- **Cost** = Σ interval kWh × rate in force at the interval start (tariff version chosen by timestamp). Energy with no tariff in force is reported as unpriced, never guessed.
- **Holding** is measured from the power trace: after the melt (≥50% of rated power) a plateau near holding power until tap. Holding energy seen on the meter is already inside the heat's kWh; the kW × minutes estimate is used only when metered energy is missing (no double counting).
- **Expected energy** = robust (Huber IRLS) linear fit of heat kWh on tonnes, cold start and holding minutes over clean history (≥24 heats, ≥98% reading completeness), so a few abnormal heats do not move the baseline; expected good practice sets holding to zero. The residual scale (1.4826 × MAD) sets the anomaly threshold. Falls back to a physics prior when history is short. A refit that moves expected energy by less than 0.5% keeps the stored model.
- **Drift** = two-sided CUSUM on daily mean residuals (k = 0.5σ, h = 5σ, σ ≥ 1%) to catch slow efficiency loss (lining, coil, capacitors) that no single heat flags.
- **Anomaly rule** (`EXPECTED_VS_ACTUAL_V1`): flag when actual − expected > max(5% of expected, 3 × model RMSE). Severity HIGH ≥ 10%, MEDIUM ≥ 5%. Findings are graded CONFIRMED / STRONG / HYPOTHESIS / INSUFFICIENT; incomplete meter data downgrades to INSUFFICIENT rather than guessing.
- **Avoided CO₂** = avoided kWh × grid factor. Load shifted in time earns no extra credit.
- **Verification** compares per tonne and scales the per-tonne saving to the average baseline production day, so a change in output never shows up as a false saving. The baseline can be a 1-, 7-, 14- or 30-day period; the SEC change gets a 90% interval (Welch t, or the baseline spread for a single comparison day) and a plain verdict on whether it exceeds normal day-to-day variation.

## Optimiser

Decision: the start minute of each planned heat, on a 5-minute grid, with the heat sequence fixed.

Hard constraints: one heat at a time with turnaround; tap no earlier than mould readiness (metal holds until then); charge ≤ capacity; heats per day; furnace availability; planned downtime (no melting or holding); maximum holding; dispatch deadline; order due times; required tonnes per order. Cold start (idle > 60 min) adds melt time and energy.

Objective (lexicographic): energy cost, then holding minutes, then earliest last tap.

Method: exact dynamic programme over states (heat index, tap minute of the previous heat). It is optimal for this model and grid. The chosen schedule is then re-evaluated by an independent checker (`evaluateSchedule`) and every constraint result is shown. A unit test compares the DP against exhaustive search. If no schedule exists, the optimiser builds the earliest possible schedule and reports which constraints block (for example "H09 cannot tap before 15:55; cut-off 15:30"); it never relaxes a hard constraint.

Every run stores a snapshot and SHA-256 fingerprint of its inputs (plan revision, tariff version, model coefficients, process parameters). A pending recommendation becomes **stale** when the fingerprint changes, and a stale recommendation cannot be approved. Advice pauses when the reference day's meter completeness is below the configured minimum (98% by default).

## Decision workflow

`PENDING → APPROVED | REJECTED | STALE | SUPERSEDED`. Approval and rejection are server actions that check permission, tenant, pending status, version and input freshness; the database's unique index on `approvals.recommendation_id` blocks a second decision even under concurrent requests. Rejection requires a reason. Approval only marks the proposed schedule version ACTIVE; nothing is sent to equipment.

## Security

- Every service call takes an `Actor` resolved on the server from the session; queries are always scoped to `actor.factory.id`. A user can only act in factories they are a member of. Hiding buttons is a convenience, not the control.
- Role permissions are enforced in services (`requirePerm`), covered by integration tests.
- Zod validation on every input; CSV files are re-validated on commit (the preview is never trusted); size and row limits on uploads and exports; CSV export cells are protected against formula injection.
- Passwords: scrypt. Sessions: random 256-bit tokens, stored as SHA-256, HttpOnly SameSite=Lax cookies, 12-hour expiry. Login is rate-limited per email.
- Security headers: per-request nonce CSP for pages (`src/proxy.ts`, scripts need the nonce; styles allow inline attributes for charts), a deny-all CSP for the API, HSTS when `COOKIE_SECURE=true`, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
- Accounts: owners add members (new accounts get a one-time password that must be changed at first sign-in), change roles, reset passwords, disable accounts (only accounts that belong to this factory alone) and remove members; the last active owner cannot be removed or demoted. Users change their password and can sign out other devices.
- Login takes the same time whether or not the email exists; limited per email and per client address.
- Internal errors are logged on the server and replaced with a generic message for the user.
- Append-only audit log of sign-ins, edits (with field diffs), imports, analyses, runs, decisions, outcomes, settings changes and exports. Events are sealed into a per-factory SHA-256 hash chain; "Verify integrity" on the Audit page recomputes it and names the first altered event. (Removing the newest events cannot be detected by a chain alone; export the head hash regularly for that.)

## Data modes

- **SIMULATION** — always for a simulation factory, with a persistent banner.
- **LIVE** — only when MEASURED readings (ingest API, real factory) arrived within the last five meter intervals.
- **OFFLINE** — otherwise. The app never shows LIVE for imported, manual or synthetic data.
