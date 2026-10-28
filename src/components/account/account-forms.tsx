"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changePasswordAction, signOutEverywhereAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function PasswordForm({ first }: { first: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (fd.get("next") !== fd.get("confirm")) return setErrors({ confirm: "The passwords do not match." });
        start(async () => {
          const r = await changePasswordAction({ current: fd.get("current"), next: fd.get("next") });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.message ?? "Could not change the password.");
          }
          toast.success("Password changed. Your other sessions were signed out.");
          router.push(first ? "/dashboard" : "/account");
          router.refresh();
        });
      }}
    >
      <Field label={first ? "One-time password" : "Current password"} htmlFor="current" error={errors.current}>
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" htmlFor="next" error={errors.next} hint="At least 10 characters.">
        <Input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field label="Repeat new password" htmlFor="confirm" error={errors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}

export function SignOutEverywhere() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await signOutEverywhereAction();
          if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not sign out.");
          toast.success(`${r.data.ended} other session${r.data.ended === 1 ? "" : "s"} ended.`);
        })
      }
    >
      Sign out other devices
    </Button>
  );
}
