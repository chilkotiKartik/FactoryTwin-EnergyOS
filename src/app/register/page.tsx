import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { currentActor } from "@/server/auth/session-next";
import { isEphemeralDemoDb } from "@/db/client";
import { registrationEnabled } from "@/server/services/registration";
import { AuthLayout } from "@/components/public/auth-layout";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await currentActor()) redirect("/dashboard");
  const enabled = registrationEnabled();
  return (
    <AuthLayout>
      <p className="text-eyebrow font-semibold uppercase text-amber">Free · private · synthetic</p>
      <h1 className="mt-2 text-[2rem] font-semibold leading-tight tracking-tight text-ink">Create your sandbox</h1>
      <p className="mt-1 text-[14px] text-ink-2">You get a private factory filled with 31 days of synthetic furnace data, so you can try the whole loop yourself.</p>
      {enabled ? (
        <>
          <div className="mt-4 flex gap-2 rounded-card border border-violet/25 bg-violet/5 p-3 text-[12.5px] text-ink-2">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
            <p>Only you can see your sandbox. Its data is simulated from the deck&apos;s foundry profile and is labelled as simulated on every screen.
              {isEphemeralDemoDb() ? " This public demo resets its database from time to time, so your sandbox is temporary." : ""}
            </p>
          </div>
          <RegisterForm />
        </>
      ) : (
        <p role="status" className="mt-6 rounded-card border border-line bg-surface p-4 text-[14px] text-ink-2">
          Self-service sign-up is turned off on this deployment. Ask a factory owner to add you from the Team panel.
        </p>
      )}
      <p className="mt-4 text-[13px] text-ink-2">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-blue underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
