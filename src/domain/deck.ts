import type { OptimizerInput } from "./optimizer";
import { DECK_MOULD_READY } from "./scenarios";
import { deckDefaultTariff, minuteRateTable, type TariffPeriod } from "./tariff";

export interface DeckDayOptions {
  /** Extra minutes the moulding line falls behind from mould set `delayFromSet` onward. */
  extraMouldDelayMin?: number;
  delayFromSet?: number;
  /** Dispatch cut-off, local minute of day. */
  deadlineMin?: number;
  /** Solar-hours discount as a fraction of the normal rate (deck: 0.20). */
  solarDiscount?: number;
  /** Evening peak multiplier on the normal rate (deck: 1.20). */
  peakMultiplier?: number;
}

export const DECK_NORMAL_RATE_PAISE = 800;

/** Tariff windows for the deck day with the given discount and premium. All rates are ASSUMPTIONS. */
export function deckPeriods(solarDiscount = 0.2, peakMultiplier = 1.2): TariffPeriod[] {
  const base = deckDefaultTariff(0).periods;
  return base.map((p) =>
    p.kind === "SOLAR"
      ? {
          ...p,
          label: `Solar hours (−${Math.round(solarDiscount * 100)}%)`,
          ratePaise: Math.round(DECK_NORMAL_RATE_PAISE * (1 - solarDiscount)),
        }
      : p.kind === "PEAK"
        ? {
            ...p,
            label: `Evening peak (${peakMultiplier.toFixed(2)}×)`,
            ratePaise: Math.round(DECK_NORMAL_RATE_PAISE * peakMultiplier),
          }
        : p,
  );
}

/**
 * The deck's foundry day as optimiser input: 12 × 500 kg heats on one 550 kW
 * furnace, the deck's mould-ready times and ToD tariff. Pure, so it runs in the
 * browser (landing-page simulator) as well as in tests.
 */
export function deckDayInput(opts: DeckDayOptions = {}): OptimizerInput {
  const { extraMouldDelayMin = 0, delayFromSet = 7, deadlineMin = 1320, solarDiscount = 0.2, peakMultiplier = 1.2 } = opts;
  const mould = DECK_MOULD_READY.map((m, k) => (k + 1 >= delayFromSet ? m + extraMouldDelayMin : m));
  const tariff = {
    ...deckDefaultTariff(0),
    id: "deck",
    periods: deckPeriods(solarDiscount, peakMultiplier),
  };
  return {
    gridMinutes: 5,
    heats: mould.map((m, k) => ({
      key: `h${k}`,
      label: `H${String(k + 1).padStart(2, "0")}`,
      orderId: k < 7 ? "o1" : "o2",
      chargeKg: 500,
      pouredKg: 500,
      mouldSet: k + 1,
      mouldReadyMin: m,
    })),
    orders: [
      { id: "o1", code: "PO-2611", requiredTonnes: 3.5, dueMin: deadlineMin },
      { id: "o2", code: "PO-2614", requiredTonnes: 2.5, dueMin: deadlineMin },
    ],
    furnace: {
      capacityKg: 500,
      ratedKw: 550,
      availableFromMin: 360,
      availableToMin: 1320,
      maxHeatsPerDay: 14,
      downtime: [],
    },
    process: {
      nominalMeltMinutes: 35,
      coldExtraMinutes: 5,
      coldGapMinutes: 60,
      turnaroundMinutes: 10,
      holdingKw: 60,
      maxHoldMinutes: 60,
    },
    meltKwh: mould.map(() => ({ warm: 323, cold: 360 })),
    pricePaise: Array.from(minuteRateTable(tariff)),
    deadlineMin,
    currentPracticeStartMin: 360,
  };
}
