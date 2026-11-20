import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "./logo";
import { EnergyFlow } from "@/components/graphics/energy-flow";
import { CountUp } from "@/components/motion/count-up";

const LOOP = [
  "Link meter energy to each heat",
  "Explain overruns from the trace",
  "Optimise start times within limits",
  "Supervisor approves or rejects",
  "Record the outcome",
  "Verify against a stated baseline",
];

/** Split layout for sign in and register: product story on the left, the form on the right. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <section className="bg-blueprint relative isolate hidden flex-col justify-between overflow-hidden p-10 text-shell-ink lg:flex">
        <div className="aurora -z-10" aria-hidden />
        <Logo />
        <div className="w-full max-w-2xl">
          <p className="text-eyebrow font-semibold uppercase text-amber-mark">Challenge 04 · Smart Manufacturing</p>
          <p className="mt-3 max-w-xl text-headline font-semibold text-white">
            Know what every heat <span className="text-sheen">should have used</span>, and plan the next shift around it.
          </p>
          <ol className="mt-7 grid grid-cols-2 gap-2 text-[13.5px] xl:grid-cols-3">
            {LOOP.map((s, i) => (
              <li
                key={s}
                className="flex animate-fade-up items-start gap-2.5 rounded-control border border-white/10 bg-white/[0.04] px-3 py-2.5 backdrop-blur-sm transition-colors hover:border-amber-mark/40 hover:bg-white/[0.07]"
                style={{ animationDelay: `${80 + i * 70}ms` }}
              >
                <span className="num mt-px grid size-5 shrink-0 place-items-center rounded-full bg-amber-mark/15 text-[10.5px] font-bold text-amber-mark">{i + 1}</span>
                <span className="leading-snug">{s}</span>
              </li>
            ))}
          </ol>
          <div className="mt-8 rounded-card border border-white/10 bg-white/[0.03] p-4 shadow-overlay backdrop-blur-sm">
            <EnergyFlow tone="dark" idPrefix="auth" />
            <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-white/10 pt-3">
              {[
                ["−3.4%", "kWh per tonne"],
                ["−7.4%", "₹ per tonne"],
                ["138 → 0", "min holding"],
              ].map(([v, l]) => (
                <div key={l} className="text-center">
                  <dt className="sr-only">{l}</dt>
                  <dd className="num text-[20px] font-semibold text-white">
                    <CountUp value={v} />
                  </dd>
                  <dd className="text-[11.5px] text-shell-muted">{l}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-center text-[11px] text-shell-muted">Illustration and deck reference day, simulated. Not a live feed or a field result.</p>
          </div>
        </div>
        <p className="max-w-lg text-[12px] text-shell-muted">
          Recommendation only. Nothing in this application sends commands to plant equipment. Demonstration factories run on synthetic data and are labelled as such everywhere.
        </p>
      </section>
      <section className="auth-canvas relative isolate flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-control text-[13px] text-ink-2 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Home
          </Link>
          <span className="lg:hidden">
            <Logo tone="light" />
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-[480px] animate-fade-up rounded-[18px] border border-line/80 bg-surface/80 p-6 shadow-overlay backdrop-blur-md sm:p-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
