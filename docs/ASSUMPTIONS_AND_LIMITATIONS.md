# Assumptions and limitations

## Evidence labels

| Label | Meaning |
|---|---|
| MEASURED | From a genuine meter (ingest API, or a CSV declared as a genuine meter export) in a non-simulation factory |
| SIMULATED | From the scenario engine, or derived from anything synthetic |
| MODELLED | A projection: optimiser predictions, expected energy, payback |
| ASSUMPTION | A configuration or business-case choice |
| VERIFIED | Backed by an identified external source (requires a source note) |
| UNVERIFIED | Manual entries or imports without a declared genuine source |

A derived figure is MEASURED only if every input is MEASURED.

## Assumptions (all editable in the app)

- Furnace: 500 kg, 550 kW, ~35 min to melt a warm charge, +5 min after a cold start (idle > 60 min), 10 min turnaround. Source: GEF–UNIDO–BEE foundry BOP guide (deck).
- Holding power 60 kW (the deck gives total holding, not power).
- Tariff: ₹8.00/kWh normal; 09:00–17:00 solar at −20% (₹6.40); 18:00–22:00 peak at 1.20× (₹9.60). Consistent with the Electricity (Rights of Consumers) Amendment Rules 2023; **not** a specific state tariff order. Replace with your DISCOM's order and mark it VERIFIED.
- Grid factor 0.727 kg CO₂/kWh (CEA CO₂ Baseline Database v20.0, FY 2023-24, as cited in the deck). A newer CEA version exists; update before relying on it.
- Business case: ₹0.9 lakh capex, ₹5,000/month opex, 300 operating days, 100% realisation (editable on Verification).
- Optimiser grid 5 minutes (refined to 1 minute around the optimum); heat sequence fixed unless reordering within an order is requested; holding cap 60 minutes.
- Shared connection (optional): power factor 0.95 (ASSUMPTION until measured); other-plant load as two levels (06:00–22:00 and overnight); contract demand as a hard cap. Demand-charge effects are shown as an upper bound that applies only if the day sets the month's billing peak.

## Deck reference vs this app

The app recomputes the deck's illustrative figures from its own synthetic data (see the Evidence page):

| Figure | Deck | App (holding-anomaly scenario) |
|---|---|---|
| As-run energy | 4,052 kWh | ≈ 4,035 kWh |
| As-run SEC | 675.4 kWh/t | ≈ 672.6 kWh/t |
| Holding | 138 min | 138 min |
| Heat 07 | 366 vs 320 kWh | ≈ 366 vs 323 kWh |
| Recommended start / last tap | 08:50 / 17:47 | 08:50 / 17:45 |
| Predicted SEC / ₹ per t | −3.4% / −7.4% | −3.4% / −7.5% |
| Simulated outcome payback | 1.9 months | ≈ 1.9 months |

## What is not claimed

- No field validation. All Foundry A data is synthetic.
- Predictions are not savings. Savings appear only after an outcome is recorded and verified, and they inherit the label of the data (SIMULATED in the demo).
- The optimiser is exact for its stated model, not for the real plant. It does not model cranes, ladles or labour. Reordering is limited to heats of the same order and is a bounded search. Demand is modelled as one furnace plus two flat levels of other load, billed on 15-minute block averages; kVAh billing and a time-varying other load are not modelled. Several furnaces are scheduled only in a domain-level priority heuristic, not in the application.
- The expected-energy model is linear in tonnes, cold start and holding minutes. It ignores charge mix, superheat, lining wear and lid practice.
- Holding detection depends on meter resolution; 1-minute data is assumed.
- No integration with a real meter, MES or ERP has been tested. The ingest API has been tested only with synthetic requests in automated tests.
- No machine control. The app has no write path to any equipment.
- SQLite suits one site. A hosted libSQL / Turso database is supported by configuration (`DATABASE_AUTH_TOKEN`) but has not been run against a live hosted instance here; background jobs and rate limiters still assume one long-running server.
- Hindi and Marathi text covers navigation, heat entry and sync only, and is an unreviewed draft.

## Sources

- Yuva Yodha Energy Tech Hackathon 2026, Challenge 04 — https://www.yuvayodhatech.com/challenges
- GEF–UNIDO–BEE, Energy Efficiency Best Operating Practices Guide for Foundries (TERI, 2015) — https://sameeeksha.org/brouchres/BOP-Guide-Oct2015.pdf
- TERI/SAMEEEKSHA, Kolhapur Foundry Cluster Profile — https://www.sameeeksha.org/pdf/clusterprofile/Kolhapur_foundry_cluster.pdf
- Ministry of Power, Electricity (Rights of Consumers) Amendment Rules 2023 (PIB PRID 1945236) — https://www.pib.gov.in/PressReleseDetailm.aspx?PRID=1945236
- CEA CO₂ Baseline Database User Guide v20.0 — https://cea.nic.in/wp-content/uploads/2021/03/User_Guide_Version_20.0.pdf
- Schneider Electric EcoStruxure Power Monitoring Expert, Energy Analysis Reports — product help
- Energy Efficient Manufacturing Scheduling: A Systematic Literature Review — https://arxiv.org/abs/2308.13585
