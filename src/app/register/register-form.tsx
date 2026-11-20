"use client";

import { useActionState } from "react";
import { registerAction } from "@/app/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit";

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      <Field label="Your name" htmlFor="name" error={fe?.name}>
        <Input id="name" name="name" autoComplete="name" required minLength={2} maxLength={80} aria-invalid={!!fe?.name} aria-describedby={fe?.name ? "name-error" : undefined} />
      </Field>
      <Field label="Work email" htmlFor="email" error={fe?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required maxLength={200} aria-invalid={!!fe?.email} aria-describedby={fe?.email ? "email-error" : undefined} />
      </Field>
      <Field label="Password" htmlFor="password" error={fe?.password} hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={200} aria-invalid={!!fe?.password} aria-describedby={fe?.password ? "password-error" : undefined} />
      </Field>
      <Field label="Sandbox factory name" htmlFor="factoryName" error={fe?.factoryName}>
        <Input id="factoryName" name="factoryName" required minLength={2} maxLength={80} placeholder="e.g. Shree Castings, Kolhapur" aria-invalid={!!fe?.factoryName} aria-describedby={fe?.factoryName ? "factoryName-error" : undefined} />
      </Field>
      {state && !state.ok && !fe ? (
        <p role="alert" className="rounded-control border border-red/25 bg-red-soft px-3 py-2 text-[13px] text-red">
          {state.message}
        </p>
      ) : null}
      <SubmitButton size="lg" pendingText="Building your sandbox…">
        Create account
      </SubmitButton>
    </form>
  );
}
