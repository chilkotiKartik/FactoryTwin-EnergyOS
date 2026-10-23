"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required defaultValue="supervisor@foundry-a.test" />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state && !state.ok ? (
        <p role="alert" className="rounded-md border border-red/25 bg-red-soft px-3 py-2 text-[13px] text-red">
          {state.message}
        </p>
      ) : null}
      <SubmitButton size="lg" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
