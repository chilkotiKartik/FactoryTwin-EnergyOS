import type { Metadata } from "next";
import Link from "next/link";
import { currentActor } from "@/server/auth/session-next";
import { registrationEnabled } from "@/server/services/registration";
import { AuthLayout } from "@/components/public/auth-layout";
import { LoginForm } from "./login-form";
import { logoutAction } from "@/app/actions";
import { ROLE_LABEL } from "@/server/permissions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const actor = await currentActor();
  if (actor) {
    // Say who is signed in instead of silently bouncing to the dashboard, so switching roles is obvious.
    return (
      <AuthLayout>
        <p className="text-eyebrow font-semibold uppercase text-amber">Already signed in</p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-tight text-ink">Hi, {actor.name.split(" ")[0]}</h1>
        <p className="mt-1.5 text-[14.5px] text-ink-2">
          You are signed in as <b className="text-ink">{actor.email}</b> ({ROLE_LABEL[actor.role]}, {actor.factory.name}).
        </p>
        <div className="mt-7 flex flex-col gap-3">
          <Link href="/dashboard" className="inline-flex h-12 items-center justify-center gap-2 rounded-control bg-ink text-[15px] font-medium text-white shadow-raised hover:bg-ink/85">
            Continue to the dashboard
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="inline-flex h-11 w-full items-center justify-center rounded-control border border-line-strong bg-surface text-[14px] font-medium text-ink hover:bg-surface-3">
              Sign out and use another account
            </button>
          </form>
        </div>
      </AuthLayout>
    );
  }
  const showDemo = (process.env.SEED_DEMO_USERS ?? "true") !== "false";
  return (
    <AuthLayout>
      <p className="text-eyebrow font-semibold uppercase text-amber">Welcome back</p>
      <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-tight text-ink">Sign in</h1>
      <p className="mt-1.5 text-[14.5px] text-ink-2">Pick up where the last shift left off.</p>
      <LoginForm
        demo={
          showDemo
            ? {
                password: process.env.DEMO_PASSWORD ?? "energyos-demo",
                accounts: [
                  { email: "supervisor@foundry-a.test", name: "Ravi Patil", role: "Supervisor", can: "Runs and approves plans" },
                  { email: "owner@foundry-a.test", name: "Owner", role: "Owner", can: "Everything, two factories" },
                  { email: "analyst@foundry-a.test", name: "Analyst", role: "Analyst", can: "Analyses, can't approve" },
                  { email: "operator@foundry-a.test", name: "Operator", role: "Operator", can: "Logs heats" },
                  { email: "owner@foundry-b.test", name: "Foundry B owner", role: "Other tenant", can: "Foundry B only: proves tenant isolation" },
                ],
              }
            : undefined
        }
      />
      {registrationEnabled() ? (
        <p className="mt-6 text-center text-[13.5px] text-ink-2">
          New here?{" "}
          <Link href="/register" className="font-semibold text-blue underline-offset-4 hover:underline">
            Create a free sandbox account
          </Link>
        </p>
      ) : null}
    </AuthLayout>
  );
}
