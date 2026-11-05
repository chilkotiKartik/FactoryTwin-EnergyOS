"use client";

import { useActionState, useState } from "react";
import { loginAction } from "@/app/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit";
import { cn } from "@/lib/cn";

export interface DemoAccounts {
  password: string;
  accounts: { email: string; role: string; note: string }[];
}

export function LoginForm({ demo }: { demo: DemoAccounts | null }) {
  const [state, action] = useActionState(loginAction, null);
  const [email, setEmail] = useState(demo ? demo.accounts[0].email : "");
  const [password, setPassword] = useState("");
  return (
    <>
      <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
        </Field>
        {state && !state.ok ? (
          <p role="alert" className="rounded-lg border border-red/25 bg-red-soft px-3 py-2 text-[13px] text-red">
            {state.message}
          </p>
        ) : null}
        <SubmitButton size="lg" pendingText="Signing in…" variant="brand">
          Sign in
        </SubmitButton>
      </form>
      {demo ? (
        <div className="card mt-8 rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Demo accounts · synthetic factory</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Tap one to fill the form. Password for all: <code className="font-mono text-ink">{demo.password}</code>
          </p>
          <ul className="mt-3 grid gap-1.5">
            {demo.accounts.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(demo.password);
                  }}
                  className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-surface-2", email === a.email ? "border-[var(--brand-2)] bg-surface-2" : "border-line")}
                >
                  <span className="brand-gradient grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white">{a.role.slice(0, 2).toUpperCase()}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[12px] text-ink">{a.email}</span>
                    <span className="block text-[11.5px] text-ink-3">
                      {a.role} · {a.note}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
