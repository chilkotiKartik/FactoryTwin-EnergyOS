import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { currentActor } from "@/server/auth/session-next";
import { PublicShell } from "@/components/public/public-shell";
import { Reveal } from "@/components/motion/reveal";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  {
    title: "Measure: energy per heat",
    what: "1-minute furnace power from the incomer meter (live gateway, CSV import or simulation) is split across heats by their start, melt-end and tap times.",
    guard: "Readings carry an evidence label. Gaps are shown as gaps, never interpolated. Energy that falls between heats is reported as unlinked, not silently assigned.",
    where: "Dashboard, Heat log, Meter data",
  },
  {
    title: "Explain: anomalies with a cause",
    what: "Each heat is compared with an energy model fitted robustly on recent heats (charge weight, cold start, holding minutes), so a few bad heats cannot drag the baseline. Overruns are flagged with the evidence: holding minutes while the mould line was late, a cold start, a data gap.",
    guard: "The explanation lists its inputs and the expected-versus-actual kWh, so a supervisor can check it, then acknowledge or resolve the anomaly.",
    where: "Anomalies, Heat detail",
  },
  {
    title: "Plan: an exact, feasible schedule",
    what: "A dynamic-programming optimiser places each heat's melt start on a 5-minute grid. It minimises energy cost (melting plus holding) under the tariff in force.",
    guard:
      "Hard limits are never relaxed: mould-ready times, maximum holding, furnace hours and downtime, the dispatch cut-off, and the tonnes per order. If no schedule fits, it says infeasible and names the blocking limit. An independent checker re-evaluates every plan.",
    where: "Schedule optimiser",
  },
  {
    title: "Decide: a supervisor approves or rejects",
    what: "The recommendation shows the schedule, the expected saving and every constraint check. A supervisor approves or rejects it, with a reason.",
    guard: "Permissions are enforced on the server. If the plan or tariff changed after the run, the recommendation is marked stale and cannot be approved.",
    where: "Approvals",
  },
  {
    title: "Record: what actually ran",
    what: "The executed heats are recorded against the approved plan. Deviations from it are kept, not overwritten.",
    guard: "Simulated outcomes are labelled SIMULATED. Only data from a connected meter is ever called MEASURED.",
    where: "Approvals → Outcome",
  },
  {
    title: "Verify: savings against a stated baseline",
    what: "kWh per tonne, ₹ per tonne and CO₂ are compared with a named baseline period, with the method, data completeness and confidence shown next to the result.",
    guard: "If completeness is below the factory threshold, the report says so instead of claiming a saving.",
    where: "Verification, Reports",
  },
];

export default async function HowItWorks() {
  const signedIn = Boolean(await currentActor());
  return (
    <PublicShell signedIn={signedIn}>
      <section className="bg-blueprint text-shell-ink">
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
          <p className="text-eyebrow font-semibold uppercase text-amber-mark">How it works</p>
          <h1 className="mt-3 text-[2.1rem] font-semibold leading-tight tracking-tight text-white sm:text-headline">One loop, from meter reading to verified saving</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed">Each step says what the app does and the rule that keeps it honest. All demo data is synthetic and labelled as such.</p>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <ol className="relative flex flex-col gap-6 border-l border-line pl-6 sm:pl-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <span className="num absolute -left-[37px] top-0 grid size-6 place-items-center rounded-full border border-line bg-surface text-[11px] font-semibold text-ink-2 sm:-left-[45px]">
                {i + 1}
              </span>
              <Reveal delay={0.05}>
                <article className="lift rounded-card border border-line bg-surface p-5 shadow-card">
                  <h2 className="text-[18px] font-semibold text-ink">{s.title}</h2>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{s.what}</p>
                  <p className="mt-3 rounded-control border border-teal/20 bg-teal-soft px-3 py-2 text-[13px] leading-relaxed text-ink-2">
                    <b className="text-teal">Guardrail.</b> {s.guard}
                  </p>
                  <p className="mt-3 text-[12px] text-ink-3">In the app: {s.where}</p>
                </article>
              </Reveal>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/#simulator" className="inline-flex h-10 items-center gap-2 rounded-control bg-ink px-4 text-[14px] font-medium text-white hover:bg-ink/85">
            Try the simulator <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href={signedIn ? "/dashboard" : "/register"}
            className="inline-flex h-10 items-center rounded-control border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink hover:bg-surface-3"
          >
            {signedIn ? "Open dashboard" : "Create a sandbox"}
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
