/**
 * Official tariff presets. Each preset reproduces a published tariff order exactly
 * and states every conversion it makes.
 *
 * MSEDCL (Maharashtra) HT I(A) Industry, FY 2026-27 — MERC Order, Case No. 75 of 2025,
 * post-remand, dated 25 March 2026:
 *   • Summary of HT Tariff for FY 2026-27 (page 99 of 123), HT I(A) HT – Industry:
 *       demand charge ₹650/kVA/month, energy charge (EC) ₹8.44/kVAh, wheeling ₹0.81/kVAh,
 *       total variable ₹9.25/kVAh.
 *   • Table 8, Revised ToD Tariff (pages 75–76), as a percentage of EC:
 *       00:00–09:00   0 %
 *       09:00–17:00   solar hours: −15 % (April–September), −25 % (October–March)
 *       17:00–24:00   peak: +20 %
 *     (the night rebate was removed by this order).
 * The order bills energy in kVAh. EnergyOS meters kWh, so each rate is divided by the
 * site power factor (kVAh = kWh ÷ PF). That conversion is the only assumption.
 */
export interface PresetPeriod {
  kind: "PEAK" | "SOLAR" | "OFFPEAK";
  label: string;
  start: string;
  end: string;
  /** ₹ per kWh. */
  rate: number;
}

export interface TariffPreset {
  id: string;
  name: string;
  /** Local date-time the version takes effect, YYYY-MM-DDTHH:MM. */
  effectiveFrom: string;
  /** ₹ per kWh outside the windows. */
  normalRate: number;
  periods: PresetPeriod[];
  sourceNote: string;
  /** Demand charge in the same order, ₹ per kVA per month. */
  demandRsPerKvaMonth: number;
}

export const MSEDCL_HT1A_FY27 = {
  energyChargeRsPerKvah: 8.44,
  wheelingRsPerKvah: 0.81,
  demandRsPerKvaMonth: 650,
  solarRebate: { aprSep: 0.15, octMar: 0.25 },
  peakCharge: 0.2,
  source: "MERC Order, Case No. 75 of 2025 (post-remand), 25 March 2026: Summary of HT Tariff FY 2026-27 p.99; Table 8 ToD pp.75–76",
} as const;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The two seasonal versions of the MSEDCL HT I(A) tariff for FY 2026-27, in ₹/kWh at power factor `pf`. */
export function msedclHt1aFy27(pf: number): TariffPreset[] {
  if (!(pf > 0.5 && pf <= 1)) throw new Error("Power factor must be between 0.5 and 1.");
  const t = MSEDCL_HT1A_FY27;
  const base = t.energyChargeRsPerKvah + t.wheelingRsPerKvah; // ₹/kVAh
  const perKwh = (rsPerKvah: number) => r2(rsPerKvah / pf);
  const peak = perKwh(base + t.peakCharge * t.energyChargeRsPerKvah);
  const season = (id: string, label: string, from: string, rebate: number): TariffPreset => ({
    id,
    name: `MSEDCL HT I(A) Industry FY 2026-27, ${label} (at PF ${pf})`,
    effectiveFrom: `${from}T00:00`,
    normalRate: perKwh(base),
    periods: [
      { kind: "SOLAR", label: `Solar hours (−${Math.round(rebate * 100)}% of EC)`, start: "09:00", end: "17:00", rate: perKwh(base - rebate * t.energyChargeRsPerKvah) },
      { kind: "PEAK", label: "Peak (+20% of EC)", start: "17:00", end: "00:00", rate: peak },
    ],
    sourceNote: `${t.source}. EC ₹8.44 + wheeling ₹0.81 = ₹9.25/kVAh; ToD as % of EC; converted to ₹/kWh at power factor ${pf} (kVAh = kWh ÷ PF). Demand charge ₹650/kVA/month.`,
    demandRsPerKvaMonth: t.demandRsPerKvaMonth,
  });
  return [season("msedcl-ht1a-fy27-aprsep", "April–September", "2026-04-01", t.solarRebate.aprSep), season("msedcl-ht1a-fy27-octmar", "October–March", "2026-10-01", t.solarRebate.octMar)];
}
