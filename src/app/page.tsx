import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Ban, ClipboardCheck, Gauge, LineChart, ScanSearch, ShieldCheck, SlidersHorizontal, Timer } from "lucide-react";
import { currentActor } from "@/server/auth/session-next";
import { registrationEnabled } from "@/server/services/registration";
import { PublicShell } from "@/components/public/public-shell";
import { ShiftSimulator } from "@/components/public/shift-simulator";

export const metadata: Metadata = {
  title: {
    absolute: "FactoryTwin EnergyOS · energy optimisation for induction-furnace foundries",
  },
};

const LOOP = [
  {
    icon: Gauge,
    title: "Measure every heat",
    body: "Meter energy is linked to each heat, so kWh per tonne is known heat by heat, not just per month.",
  },
  {
    icon: ScanSearch,
    title: "Explain the overrun",
    body: "When a heat uses more than its baseline, the trace shows why: holding while moulds were late, a cold start, missing data.",
  },
  {
    icon: SlidersHorizontal,
    title: "Plan a feasible shift",
    body: "An exact optimiser moves melt start times into cheaper hours and out of holding, inside every furnace and dispatch limit.",
  },
  {
    icon: ClipboardCheck,
    title: "A supervisor decides",
    body: "Nothing changes on the shop floor until a supervisor approves. Every decision is recorded with its reason.",
  },
  {
    icon: Timer,
    title: "Record what ran",
    body: "The executed schedule is logged against the plan, deviations and all.",
  },
  {
    icon: LineChart,
    title: "Verify the saving",
    body: "Savings are computed against a stated baseline, with the method and data quality shown next to the number.",
  },
];

const RULES = [
  {
    icon: ShieldCheck,
    title: "Simulated is never called measured",
    body: "Every figure carries its evidence label. LIVE appears only when real meter data is arriving.",
  },
  {
    icon: Ban,
    title: "Recommendation only",
    body: "The app never sends commands to plant equipment. People run the furnace.",
  },
  {
    icon: BadgeCheck,
    title: "It says no when it should",
    body: "Poor data pauses advice. Impossible limits produce a clear 'infeasible' with the blocking constraint, not a bent rule.",
  },
];

export default async function Landing() {
  const signedIn = Boolean(await currentActor());
  const canRegister = registrationEnabled();
  return (
    <PublicShell signedIn={signedIn}>
      <section className="bg-blueprint text-shell-ink">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 lg:pt-20">
          <div className="grid animate-fade-up gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:items-end">
            <div>
              <p className="text-eyebrow font-semibold uppercase text-amber-mark">For induction-furnace foundries</p>
              <h1 className="mt-4 text-[2.4rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-display">Every heat, the energy it should have used.</h1>
              <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-shell-ink">
                FactoryTwin EnergyOS links furnace meter data to each heat, explains overruns, and plans the next shift around tariffs and the moulding line. A supervisor approves. Savings are
                verified afterwards.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {signedIn ? (
                  <Link href="/dashboard" className="inline-flex h-11 items-center gap-2 rounded-control bg-amber-mark px-5 text-[15px] font-medium text-white hover:bg-amber">
                    Open dashboard <ArrowRight className="size-4" aria-hidden />
                  </Link>
                ) : (
                  <>
                    <Link
                      href={canRegister ? "/register" : "/login"}
                      className="inline-flex h-11 items-center gap-2 rounded-control bg-amber-mark px-5 text-[15px] font-medium text-white hover:bg-amber"
                    >
                      {canRegister ? "Create a free sandbox" : "Sign in"} <ArrowRight className="size-4" aria-hidden />
                    </Link>
                    <Link href="/login" className="inline-flex h-11 items-center rounded-control border border-white/20 px-5 text-[15px] font-medium text-white hover:bg-white/10">
                      Use a demo login
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div>
              <dl className="grid max-w-md grid-cols-3 gap-4 border-t border-white/10 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                {[
                  ["−3.4%", "kWh per tonne"],
                  ["−7.4%", "₹ per tonne"],
                  ["138 → 0", "min holding"],
                ].map(([v, l]) => (
                  <div key={l}>
                    <dt className="sr-only">{l}</dt>
                    <dd className="num text-[22px] font-semibold text-white">{v}</dd>
                    <dd className="text-[12px] text-shell-muted">{l}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11.5px] text-shell-muted lg:pl-8">Deck reference day, simulated. Not a field result.</p>
            </div>
          </div>
          <div id="simulator" className="scroll-mt-20">
            <p className="mb-3 text-[13px] text-shell-ink">
              <b className="text-white">Try it.</b> Change the shift and watch the optimiser re-plan it.
            </p>
            <ShiftSimulator />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="loop-h">
        <p className="text-eyebrow font-semibold uppercase text-amber">The closed loop</p>
        <h2 id="loop-h" className="mt-2 max-w-2xl text-headline font-semibold text-ink">
          From the meter to a verified saving, in six steps.
        </h2>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LOOP.map((s, i) => (
            <li key={s.title} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-control bg-amber-soft text-amber">
                  <s.icon className="size-4.5" aria-hidden />
                </span>
                <span className="num text-[12px] font-semibold text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="mt-4 text-[16px] font-semibold text-ink">{s.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
        <Link href="/how-it-works" className="mt-8 inline-flex items-center gap-1.5 text-[14px] font-medium text-blue underline-offset-4 hover:underline">
          How each step works <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

      <section className="border-y border-line bg-surface" aria-labelledby="rules-h">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="rules-h" className="max-w-2xl text-headline font-semibold text-ink">
            Built to be trusted on a shop floor.
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {RULES.map((r) => (
              <div key={r.title}>
                <r.icon className="size-6 text-teal" aria-hidden />
                <h3 className="mt-3 text-[16px] font-semibold text-ink">{r.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{r.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-headline font-semibold text-ink">See it on your own sandbox factory.</h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] text-ink-2">31 days of synthetic furnace data, five scenarios and the full decision loop. Private to you.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href={signedIn ? "/dashboard" : canRegister ? "/register" : "/login"}
            className="inline-flex h-11 items-center gap-2 rounded-control bg-ink px-5 text-[15px] font-medium text-white hover:bg-ink/85"
          >
            {signedIn ? "Open dashboard" : canRegister ? "Create a free sandbox" : "Sign in"} <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
