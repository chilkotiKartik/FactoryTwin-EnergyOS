# Three-minute demo

Before: `pnpm db:reset && pnpm dev`, or **Scenario control → Holding-energy anomaly → Load**. Sign in as `supervisor@foundry-a.test` / `energyos-demo`. The violet banner stays visible throughout: everything is synthetic.

**0:00 – 0:20 · The problem.** Dashboard, day 20 Oct. "A 500 kg induction furnace, 12 heats, 6 tonnes. 4,035 kWh, 673 kWh per tonne, ₹4,616 per tonne. The decision loop across the top shows where we are." Point at the 138 minutes of holding.

**0:20 – 0:50 · Explainable anomaly.** Click the amber bar for H07 in *SEC by heat* (or Anomalies → H07). "Expected 323 kWh, actual 366: +13%. The trace shows 45 minutes of holding after melting finished, and the heat log says mould set 7 was ready 45 minutes after the metal. Evidence: confirmed. It tells us what to check, not who to blame."

**0:50 – 1:40 · Feasible schedule.** Schedule optimiser → *Run optimiser* (≈40 ms). "Same 12 heats, same sequence, same 6 tonnes. Start at 08:50 instead of 06:00: holding drops from 138 to 0 minutes and melting moves into the solar window. Every hard constraint is re-checked independently: mould readiness, capacity, availability, deadline, orders." Point at *Predicted effect*: −3.4% kWh/t, −7.5% ₹/t, labelled MODELLED. Optional: Scenario control → *Infeasible plan* shows how it explains a plan that cannot be met.

**1:40 – 2:15 · Human decision.** *Review & decide*. "The analyst could run this but cannot approve; the server enforces that, not the button." Approve. "Recorded with who, when, version and input fingerprint. If the plan or tariff changes, this recommendation goes stale and can't be approved. No command goes to the furnace."

**2:15 – 2:50 · Verification.** Verification → *Run approved schedule (simulated)*. "Per tonne, baseline vs outcome: SEC −3.5%, ₹ per tonne −7.6%, about 100 kg CO₂ avoided per day, payback about 1.9 months on ₹0.9 lakh, break-even at about 10% realisation. Labelled SIMULATED, because it is." Save the report; show *Print / save as PDF*.

**2:50 – 3:00 · Close.** Evidence & assumptions page: "Every number is labelled, every assumption is editable, and the deck's figures are recomputed here rather than copied. Next step: one real meter on one furnace."
