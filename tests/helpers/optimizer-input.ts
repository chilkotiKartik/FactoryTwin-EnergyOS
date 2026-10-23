import { deckDefaultTariff, minuteRateTable } from "@/domain/tariff";
import type { OptimizerInput } from "@/domain/optimizer";
import { DECK_MOULD_READY } from "@/domain/scenarios";

/** Deck day: 12 × 500 kg heats, deck mould times, deck ToD tariff. */
export function deckInput(over: Partial<OptimizerInput> = {}, mould: (number | null)[] = DECK_MOULD_READY): OptimizerInput {
  const t = deckDefaultTariff(0);
  const n = mould.length;
  return {
    gridMinutes: 5,
    heats: mould.map((m, k) => ({ key: `h${k}`, label: `H${String(k + 1).padStart(2, "0")}`, orderId: k < 7 ? "o1" : "o2", chargeKg: 500, pouredKg: 500, mouldSet: k + 1, mouldReadyMin: m })),
    orders: [
      { id: "o1", code: "PO-1", requiredTonnes: Math.min(7, n) * 0.5, dueMin: 1320 },
      ...(n > 7 ? [{ id: "o2", code: "PO-2", requiredTonnes: (n - 7) * 0.5, dueMin: 1320 }] : []),
    ],
    furnace: { capacityKg: 500, ratedKw: 550, availableFromMin: 360, availableToMin: 1320, maxHeatsPerDay: 14, downtime: [] },
    process: { nominalMeltMinutes: 35, coldExtraMinutes: 5, coldGapMinutes: 60, turnaroundMinutes: 10, holdingKw: 60, maxHoldMinutes: 60 },
    meltKwh: mould.map(() => ({ warm: 323, cold: 360 })),
    pricePaise: Array.from(minuteRateTable({ ...t, id: "t1" })),
    deadlineMin: 1320,
    currentPracticeStartMin: 360,
    ...over,
  };
}
