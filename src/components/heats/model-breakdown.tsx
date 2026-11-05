import type { PredictionExplanation } from "@/domain/model";
import { fmt } from "@/lib/format";

/** Where the expected energy comes from, and where the actual figure sits against the model's scatter. */
export function ModelBreakdown({ x, kind, n }: { x: PredictionExplanation; kind: "OLS" | "PHYSICS_PRIOR"; n: number }) {
  const shown = x.terms.filter((t) => t.kwh !== 0);
  const max = Math.max(1, ...shown.map((t) => Math.abs(t.kwh)));
  const lowConfidence = kind === "PHYSICS_PRIOR" || n < 40;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <ul className="flex flex-col gap-1.5" aria-label="Contribution of each term to the prediction">
        {shown.map((t) => (
          <li key={t.key} className="grid grid-cols-[130px_1fr_70px] items-center gap-2">
            <span className="text-ink-2">{t.label}</span>
            <span className="h-2 rounded bg-surface-3" aria-hidden>
              <span className={`block h-2 rounded ${t.key === "holding" ? "bg-amber-mark" : "bg-ink-3"}`} style={{ width: `${Math.max(2, (Math.abs(t.kwh) / max) * 100)}%` }} />
            </span>
            <span className="num text-right">{fmt(t.kwh, 1)} kWh</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-2">
        <dt className="text-ink-3">Expected (good practice)</dt>
        <dd className="num text-right">{fmt(x.expectedGoodPracticeKwh, 1)} kWh</dd>
        {x.rangeKwh ? (
          <>
            <dt className="text-ink-3">Typical range (95%)</dt>
            <dd className="num text-right">
              {fmt(x.rangeKwh.low, 0)}–{fmt(x.rangeKwh.high, 0)} kWh
            </dd>
          </>
        ) : null}
        {x.zScore !== null ? (
          <>
            <dt className="text-ink-3">Actual vs model scatter</dt>
            <dd className="num text-right">
              {x.zScore >= 0 ? "+" : "−"}
              {fmt(Math.abs(x.zScore), 1)} σ
            </dd>
          </>
        ) : null}
      </dl>
      <p className={lowConfidence ? "text-amber" : "text-ink-3"}>
        {kind === "PHYSICS_PRIOR"
          ? "Low confidence: not enough clean history, so this uses rated power × melt time rather than a fit."
          : n < 40
            ? `Moderate confidence: fitted on ${n} heats. The range narrows as more clean heats are logged.`
            : `Fitted on ${n} heats. Charge mix, tap temperature and lining age are not in the model, so they widen the range.`}
      </p>
    </div>
  );
}
