import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session-next";
import { registrationEnabled } from "@/server/services/registration";
import { AuthLayout } from "@/components/public/auth-layout";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await currentActor()) redirect("/dashboard");
  const showDemo = (process.env.SEED_DEMO_USERS ?? "true") !== "false";
  return (
    <AuthLayout>
      <h1 className="text-title font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-[14px] text-ink-2">Use your factory account.</p>
      <LoginForm />
      {registrationEnabled() ? (
        <p className="mt-4 text-[13px] text-ink-2">
          New here?{" "}
          <Link href="/register" className="font-medium text-blue underline-offset-4 hover:underline">
            Create a free sandbox account
          </Link>
        </p>
      ) : null}
      {showDemo ? (
        <div className="mt-8 rounded-card border border-line bg-surface p-4 shadow-card">
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
    </AuthLayout>
  );
}
