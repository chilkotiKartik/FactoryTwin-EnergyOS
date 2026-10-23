import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Factory } from "lucide-react";
import { currentActor } from "@/server/auth/session-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await currentActor()) redirect("/dashboard");
  const showDemo = (process.env.SEED_DEMO_USERS ?? "true") !== "false";
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-shell p-10 text-shell-ink lg:flex">
        <div className="flex items-center gap-2.5 text-white">
          <div className="grid size-8 place-items-center rounded bg-amber-mark">
            <Factory className="size-4.5" aria-hidden />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">FactoryTwin EnergyOS</span>
        </div>
        <div className="max-w-lg">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-amber-mark">Challenge 04 · Smart Manufacturing</p>
          <h1 className="mt-3 text-[34px] font-semibold leading-[1.15] tracking-tight text-white">Know what every heat should have used — and plan the next shift around it.</h1>
          <ol className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
            {["Link meter energy to each heat", "Explain overruns from the trace", "Optimise start times within limits", "Supervisor approves or rejects", "Record the outcome", "Verify against a stated baseline"].map((s, i) => (
              <li key={s} className="flex gap-2.5">
                <span className="num mt-px text-[12px] font-semibold text-shell-muted">{String(i + 1).padStart(2, "0")}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="max-w-lg text-[12px] text-shell-muted">
          Recommendation only. Nothing in this application sends commands to plant equipment. The demonstration factory runs on synthetic data and is labelled as such everywhere.
        </p>
      </section>
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <h2 className="text-[22px] font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-[14px] text-ink-2">Use your factory account.</p>
          <LoginForm />
          {showDemo ? (
            <div className="mt-8 rounded-lg border border-line bg-surface p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Demo accounts (synthetic factory)</p>
              <p className="mt-1 text-[12px] text-ink-3">
                Password for all: <code className="font-mono text-ink">{process.env.DEMO_PASSWORD ?? "energyos-demo"}</code>
              </p>
              <ul className="mt-2 space-y-1 text-[13px]">
                {[
                  ["supervisor@foundry-a.test", "Supervisor: runs, approves"],
                  ["owner@foundry-a.test", "Owner: everything, two factories"],
                  ["analyst@foundry-a.test", "Analyst: analyses, cannot approve"],
                  ["operator@foundry-a.test", "Operator: logs heats"],
                  ["owner@foundry-b.test", "Other tenant (Foundry B only)"],
                ].map(([e, r]) => (
                  <li key={e} className="flex flex-col">
                    <code className="font-mono text-[12px] text-ink">{e}</code>
                    <span className="text-[12px] text-ink-3">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
