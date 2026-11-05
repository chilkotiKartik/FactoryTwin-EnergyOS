# Why EnergyOS exists — the evidence

This page records the facts the product is built on, where each one comes from, and how sure we are of it. Figures from different sources disagree; where they do, both are given. Nothing here is a measured result from EnergyOS itself: the demo factory runs on synthetic data.

## 1. The sector

| Fact | Value | Source | Confidence |
|---|---|---|---|
| Foundry units in India | more than 5,000 (one academic source: more than 6,000) | [BEE SIDHIEE — Foundry](https://sidhiee.beeindia.gov.in/AboutUs/foundry); [Institute of Indian Foundrymen profile](https://www.foundryinfo-india.org/About_Us/profile_of_indian.aspx) | Medium: estimates vary |
| Installed capacity | about 7.5 million tonnes per year | [BEE SIDHIEE — Foundry](https://sidhiee.beeindia.gov.in/AboutUs/foundry) | Medium |
| Share that are MSMEs | about 95% | [IIF Foundry Frontier, Apr 2026](https://indianfoundry.org/upload/pdf/1777965726-FOUNDRY-FRONTIER-Apr-26.pdf) | Medium |
| Energy as a share of production cost | typically 12–15% (foundry-specific); 20–30% is a cross-MSME figure | [IIF profile](https://www.foundryinfo-india.org/About_Us/profile_of_indian.aspx); [TERI, small-scale foundries](https://rkp.teriin.org/public/foreword_docs/Towadrs%20cleaner%20Technologies%20a%20process%20story%20in%20small-scale%20foundries.pdf); [UNIDO MSME evaluation](https://downloads.unido.org/ot/30/75/30757574/) | Medium; foundry figure is older |
| Cost pressure is real | about 400 Coimbatore foundries shut temporarily over input costs; the industry asked for power-cost relief | [SteelOrbis](https://www.steelorbis.com/steel-news/latest-news/indian-foundry-sector-seeks-pig-iron-import-duty-cut-and-power-subsidies-amid-rising-costs-1180919.htm) | Reported news |

**Why it matters:** thousands of small plants, each with thin margins and energy as the second- or third-largest cost, and few engineers to analyse meter data. A tool has to be cheap, explain itself, and work with a supervisor and a tablet.

## 2. How much energy a melt should take

| Fact | Value | Source |
|---|---|---|
| CII norm, induction furnace | 620 kWh per tonne of liquid metal | [IIF technical paper](https://www.foundryinfo-india.org/tech_section/pdf/57ifctp12.pdf) |
| Measured plants in the same paper | 13–21% above that norm | same |
| One measured grey-iron foundry | 660–683 kWh per tonne of melt | [Swansea-hosted paper](https://cronfa.swansea.ac.uk/Record/cronfa24998/Download/0024998-08122015182331.pdf) |
| Range reported for induction foundries | 700–2,000 kWh per tonne of finished casting (whole plant, per casting, not per melt) | [Down To Earth, citing BEE 2020](https://www.downtoearth.org.in/renewable-energy/maharashtras-clean-industry-plan-runs-into-funding-and-policy-gaps-in-kolhapur-foundries) |

**Why it matters:** the gap between a good melt and a typical one is in the order of 10–20%. That gap is what "expected vs actual" per heat makes visible. The demo's 675 kWh/t sits inside the measured range.

## 3. Where the gap comes from: holding

- Radiation is about 75% of heat loss from an open furnace; covering it and not holding longer than needed are the main levers. ([Foundry Management & Technology](https://www.foundrymag.com/melt-pour/article/21925030/reduce-power-consumption-without-sacrificing-production))
- Long holding times raise energy use; high melting utilisation means short holds. ([GIFA / Otto Junker report](https://www.gifa.com/en/Media_News/News/Reports/Reducing_Energy_Consumption_in_Metal_Melting_Using_Induction_Furnaces_through_Best_Practices_and_Digital_Melt_Process_Data_Analysis))
- Superheating metal by under 10% can raise heat losses by about a third. (same Foundry Management & Technology article)
- Melt data logged per charge is the basis for finding these losses. (GIFA report above)

**Why it matters:** holding is invisible in a monthly bill but obvious in a one-minute power trace — a long, flat, low-power stretch after melting. The most common cause is that the mould is not ready. That is a *scheduling* problem, which is why EnergyOS pairs trace analysis with a schedule optimiser rather than only reporting.

## 4. Time-of-day tariffs make timing worth money

The Electricity (Rights of Consumers) Amendment Rules, 2023 ([PIB](https://pib.gov.in/PressReleasePage.aspx?PRID=1945236)):

- Time-of-day tariffs for commercial and industrial consumers with maximum demand above 10 kW from 1 April 2024.
- Solar hours (8 hours, set by each state commission) at least 20% below the normal tariff in the notified rules (some press reports say 10–20%). ([Mercom](https://mercomindia.com/lower-electricity-tariff-solar-hours))
- Peak hours at least 1.2× normal for C&I consumers. ([Powerline](https://powerline.net.in/2023/08/02/differential-pricing-new-electricity-rule-amendments-aim-to-promote-tod-tariffs/))
- The Power Minister presented solar-hour shifting as a saving for MSMEs specifically. ([Energetica India](https://energetica-india.net/news/msmes-to-benefit-from-tod-tariffs-by-shifting-consumption-during-solar-hours-says-power-minister))
- Implementation varies by state; at least one regulator kept its old structure. ([Mercom, Uttarakhand](https://www.mercomindia.com/uttarakhand-regulator-asks-upcl-to-set-solar-non-solar-hours-for-tariffs))

**Why it matters:** the same melt costs about a third less in solar hours than in the evening peak (₹6.40 vs ₹9.60 in the illustrative tariff). Moving the first start to remove holding *and* land melting in solar hours is the core recommendation. Because tariffs differ by state, every tariff in the app is versioned and labelled ASSUMPTION until a real tariff order is entered and marked VERIFIED.

## 5. Emissions

- India's grid weighted-average emission factor for FY 2023-24 is commonly cited as 0.727 tCO₂/MWh (renewable-adjusted). ([Saur Energy on the CEA database](https://www.saurenergy.com/solar-energy-news/ceas-co2-baseline-database-impact-of-re-on-indian-grid-emissions-intensity))
- CEA has since published **Version 22.0** of the CO₂ Baseline Database (August 2026) with FY 2025-26 data. ([CEA user guide v22.0](https://cea.nic.in/wp-content/uploads/baseline/2026/09/User_Guide__Version_22.0.pdf)) The app's default still uses 0.727 and says so; an owner should update it in Factory settings from the latest version before quoting avoided CO₂.

## 6. What this means for the product (design decisions)

| Evidence | Decision in EnergyOS |
|---|---|
| Small plants, little analyst time | One screen per job, plain-language findings, a supervisor approves; no data-science vocabulary |
| Gap of 10–20% vs norm, mostly holding | Per-heat expected vs actual, with holding detected from the trace and quantified |
| Holding caused by mould readiness | The optimiser moves start times around mould-ready times; it never cuts production |
| ToD tariffs differ by state and change | Versioned tariffs, evidence labels, re-pricing on change, recommendations go stale when inputs change |
| Savings claims need trust | Predictions labelled MODELLED; savings only after an outcome is recorded and verified per tonne; tamper-evident audit log |
| Shop-floor reality: tablets, patchy Wi-Fi, local languages | Offline heat queue, "Now" buttons, Hindi and Marathi |
| Advice must never cause harm | Advisory only: no write path to any equipment |

## 7. What we removed and why

- **Docker packaging.** Not needed to run the product and not wanted by the team; it is a plain Node.js app (`pnpm build && pnpm start`).
- **The multi-furnace solver.** It existed only in code; the data model is one furnace per factory, so no screen could use it. Unreachable code is a maintenance cost with no user benefit. It can return with a proper multi-furnace data model.

## 8. Open questions (not claimed)

- No field trial yet; every number in the demo is synthetic.
- The demand-charge view uses two flat levels of other-plant load; a real site needs the main-meter profile.
- The Hindi and Marathi text needs review by a native speaker from the plant.
