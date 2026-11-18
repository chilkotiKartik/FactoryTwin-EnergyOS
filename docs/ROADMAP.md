# What is left — roadmap

Status as of 13 Nov 2026. Everything listed under "Done" is covered by tests (167 unit/integration tests on PostgreSQL 16 and PGlite, and 20 browser tests on desktop and phone). The rest is ordered by what it takes to go from a convincing demo to a paid pilot in a real foundry.

## Done

- Heat-level energy: meter ↔ heat linking, robust expected-energy model, holding detection, explainable anomalies with evidence levels.
- Exact schedule optimiser (1-minute refined), opt-in reordering within an order, shared-connection demand cap, what-if sandbox.
- In-shift re-planning: when a heat runs late, re-optimise the rest of the day from now, keeping poured heats as they ran.
- Human decision loop: approve/reject, stale detection, outcome recording, per-tonne verification with confidence intervals.
- Live India data: IEX Day-Ahead Market prices every 30 minutes; sourced research page with a savings calculator.
- Tablet use: offline heat queue, "Now" buttons, installable app, Hindi and Marathi for navigation and heat entry; light/dark; phone layout.
- Trust: tamper-evident audit chain, evidence labels on every figure, advisory-only (no write path to equipment).
- Reference data: CEA v22.0 grid factor (0.675, FY 2025-26); MSEDCL HT I(A) FY 2026-27 tariff preset from the MERC order.
- Meter gateway (`gateway/`): reads Modbus TCP energy meters, buffers offline, pushes counter readings.
- Webhooks: DNS resolved once, every address checked, connection pinned (no DNS rebinding), redirects refused.
- Platform: PostgreSQL with advisory locks, shared rate limits and a durable job queue (safe on several instances); read-only Integration API with keys and OpenAPI; cron tick for sleeping/serverless hosts; Render Blueprint deployment.

## Next — needed for a real pilot (weeks)

| # | Item | Why it matters | Needs |
|---|---|---|---|
| 1 | **Connect the plant's real meter** to the gateway in `gateway/` (Modbus TCP, offline buffer; tested against a simulated meter) | The software is done; it has not yet read a real meter | The meter's register map and a PC or Raspberry Pi on the plant network |
| 2 | **The plant's own tariff** confirmed against a real bill | MSEDCL HT I(A) FY 2026-27 is built in as a preset (Maharashtra); other states need their own order | The plant's bill and, outside Maharashtra, its DISCOM order |
| 3 | **Native-speaker review** of Hindi and Marathi, then translate the remaining screens | Operators should not need English | A reviewer from the plant |
| 4 | **Paid hosting** (Render Starter + Basic database, about US$13/month) | The free tier sleeps and the free database expires on 13 Dec 2026 | A decision and a card on the Render account |
| 5 | **Email or WhatsApp alerts** through the existing signed webhook | Supervisors live on their phones | A gateway account (for example WhatsApp Business API) |

## Then — scale (months)

| # | Item | Notes |
|---|---|---|
| 6 | Several furnaces per factory, sharing one connection | The demand-cap optimiser exists; the data model is one furnace per factory. Needs furnace-level plans, meters and screens. |
| 7 | Richer energy model: charge mix, tap temperature, lining age | Fields must first be captured on the heat form. |
| 8 | Heat reordering by a full solver (MILP / CP-SAT) | Today: bounded local search within an order. |
| 9 | Solar / battery on site | Would add a generation profile to the shared-connection model. |
| 10 | Daily rollups and raw-data retention | Not needed yet (measured: 16–131 ms at 124 days); revisit beyond about a year of one-minute data or several sites. |
| 11 | SSO (Google / Microsoft) for owners | Accounts are email + password today. |

## Not planned

- **Controlling equipment.** EnergyOS advises; people decide and act. A wrong command to a furnace is a safety risk no saving justifies.
- **Container packaging.** It is a plain Node.js app; the team does not want containers.
