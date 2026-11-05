import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Zap } from "lucide-react";
import { currentActor } from "@/server/auth/session-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Sourced context for the sign-in screen; full references on /why and in docs/RESEARCH.md. */
const FACTS = [
  { value: "5,000+", label: "foundry units in India, ~95% of them MSMEs", source: "BEE · IIF" },
  { value: "12–15%", label: "of a foundry's production cost is energy", source: "IIF · TERI" },
  { value: "≥ 20%", label: "cheaper power in solar hours under the 2023 ToD rules", source: "Ministry of Power" },
];

const STEPS = ["Link meter energy to each heat", "Explain overruns from the trace", "Optimise start times within limits", "Supervisor approves or rejects", "Record the outcome", "Verify against a stated baseline"];

export default async function LoginPage() {
  if (await currentActor()) redirect("/dashboard");
  const showDemo = (process.env.SEED_DEMO_USERS ?? "true") !== "false";
  const demo = showDemo
    ? {
        password: process.env.DEMO_PASSWORD ?? "energyos-demo",
        accounts: [
          { email: "supervisor@foundry-a.test", role: "Supervisor", note: "runs, approves" },
          { email: "owner@foundry-a.test", role: "Owner", note: "everything, two factories" },
          { email: "analyst@foundry-a.test", role: "Analyst", note: "analyses, cannot approve" },
          { email: "operator@foundry-a.test", role: "Operator", note: "logs heats" },
          { email: "owner@foundry-b.test", role: "Foundry B", note: "other tenant, live mode" },
        ],
      }
    : null;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-shell p-10 text-shell-ink lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_24rem_at_10%_0%,rgb(99_102_241/0.35),transparent_60%),radial-gradient(30rem_20rem_at_100%_100%,rgb(6_182_212/0.25),transparent_60%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="relative flex items-center gap-3 text-white">
          <div className="brand-gradient grid size-10 place-items-center rounded-xl shadow-[0_8px_32px_-8px_var(--brand-2)]">
            <Zap className="size-5" aria-hidden />
          </div>
          <span className="text-[16px] font-semibold tracking-tight">
            FactoryTwin <span className="brand-text">EnergyOS</span>
          </span>
        </div>
        <div className="relative max-w-xl">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-1)]">Heat-level energy intelligence · induction foundries</p>
          <h1 className="mt-4 text-[38px] font-semibold leading-[1.1] tracking-tight text-white">Know what every heat should have used — and plan the next shift around it.</h1>
          <dl className="mt-8 grid grid-cols-3 gap-3">
            {FACTS.map((f) => (
              <div key={f.value} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
                <dt className="sr-only">{f.label}</dt>
                <dd>
                  <span className="num block text-[22px] font-semibold text-white">{f.value}</span>
                  <span className="mt-1 block text-[12px] leading-snug text-shell-ink">{f.label}</span>
                  <span className="mt-1.5 block text-[10.5px] uppercase tracking-wide text-shell-muted">{f.source}</span>
                </dd>
              </div>
            ))}
          </dl>
          <ol className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-2.5">
                <span className="num mt-px text-[12px] font-semibold text-[var(--brand-1)]">{String(i + 1).padStart(2, "0")}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="relative max-w-lg text-[12px] text-shell-muted">
          Recommendation only. Nothing in this application sends commands to plant equipment. The demonstration factory runs on synthetic data and is labelled as such everywhere.
        </p>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm animate-[slideUp_280ms_ease-out]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="brand-gradient grid size-9 place-items-center rounded-xl text-white">
              <Zap className="size-[18px]" aria-hidden />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">
              FactoryTwin <span className="brand-text">EnergyOS</span>
            </span>
          </div>
          <h2 className="text-[26px] font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-[14px] text-ink-2">Use your factory account.</p>
          <LoginForm demo={demo} />
        </div>
      </section>
    </main>
  );
}
