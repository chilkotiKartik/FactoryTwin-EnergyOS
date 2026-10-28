import type { Metadata } from "next";
import Link from "next/link";
import { requireActor } from "@/server/auth/session-next";
import { ROLE_LABEL } from "@/server/permissions";
import { logoutAction } from "@/app/actions";
import { PasswordForm, SignOutEverywhere } from "@/components/account/account-forms";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage(props: PageProps<"/account">) {
  const actor = await requireActor();
  const sp = await props.searchParams;
  const first = actor.mustChangePassword === true || sp.first === "1";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{first && actor.mustChangePassword ? "Choose your password" : "Your account"}</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          {actor.name} · {actor.email} · {ROLE_LABEL[actor.role]} at {actor.factory.name}
        </p>
        {actor.mustChangePassword ? <p className="mt-2 rounded-md border border-amber/30 bg-amber-soft p-2 text-[13px] text-amber">You signed in with a one-time password. Set your own before continuing.</p> : null}
      </div>
      <PasswordForm first={first} />
      {!actor.mustChangePassword ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <SignOutEverywhere />
          <Link href="/dashboard" className="text-[13px] text-blue hover:underline">
            Back to the dashboard
          </Link>
        </div>
      ) : (
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      )}
    </main>
  );
}
