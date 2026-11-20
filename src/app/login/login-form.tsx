"use client";

import { useActionState, useRef, useState } from "react";
import { ArrowRight, BadgeCheck, Building2, Eye, EyeOff, FlaskConical, Hammer, LineChart, Lock, Mail } from "lucide-react";
import { loginAction } from "@/app/actions";
import { SubmitButton } from "@/components/ui/submit";
import { cn } from "@/lib/cn";

export interface DemoAccount {
  email: string;
  name: string;
  role: string;
  can: string;
}

const ROLE_STYLE: Record<string, { icon: React.ComponentType<{ className?: string }>; tint: string }> = {
  Supervisor: { icon: BadgeCheck, tint: "from-amber-mark/25 to-amber-mark/5 text-amber" },
  Owner: { icon: Building2, tint: "from-blue/25 to-blue/5 text-blue" },
  Analyst: { icon: LineChart, tint: "from-violet/25 to-violet/5 text-violet" },
  Operator: { icon: Hammer, tint: "from-teal/25 to-teal/5 text-teal" },
  "Other tenant": { icon: FlaskConical, tint: "from-ink/15 to-ink/5 text-ink-2" },
};

const field =
  "peer h-11 w-full rounded-control border border-line-strong bg-surface pl-10 pr-3 text-[14.5px] text-ink shadow-[inset_0_1px_0_rgb(15_23_39/0.03)] transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-blue focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--blue)_16%,transparent)] focus:outline-none aria-[invalid=true]:border-red";

export function LoginForm({ demo }: { demo?: { password: string; accounts: DemoAccount[] } }) {
  const [state, action] = useActionState(loginAction, null);
  const [show, setShow] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const failed = Boolean(state && !state.ok);

  function signInAs(email: string) {
    if (!demo || !emailRef.current || !passRef.current) return;
    emailRef.current.value = email;
    passRef.current.value = demo.password;
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={action} className="mt-7 flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[12.5px] font-medium text-ink-2">
            Email
          </label>
          <div className="relative">
            <input ref={emailRef} id="email" name="email" type="email" autoComplete="username" required defaultValue="supervisor@foundry-a.test" aria-invalid={failed} className={field} />
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3 transition-colors peer-focus:text-blue" aria-hidden />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[12.5px] font-medium text-ink-2">
            Password
          </label>
          <div className="relative">
            <input ref={passRef} id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required aria-invalid={failed} className={cn(field, "pr-11")} />
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3 transition-colors peer-focus:text-blue" aria-hidden />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-control text-ink-3 hover:bg-surface-3 hover:text-ink"
            >
              {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
        </div>
        {failed ? (
          <p role="alert" className="animate-fade-up rounded-control border border-red/25 bg-red-soft px-3 py-2 text-[13px] text-red">
            {state!.message}
          </p>
        ) : null}
        <SubmitButton size="lg" pendingText="Signing in…" className="group relative h-12 overflow-hidden text-[15px] shadow-raised">
          <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/15 transition-transform duration-700 group-hover:translate-x-[420%]" aria-hidden />
          Sign in <ArrowRight className="transition-transform group-hover:translate-x-0.5" aria-hidden />
        </SubmitButton>
      </form>

      {demo ? (
        <section aria-labelledby="demo-h" className="mt-8">
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line" aria-hidden />
            <h2 id="demo-h" className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Or try a demo role, one click
            </h2>
            <span className="h-px flex-1 bg-line" aria-hidden />
          </div>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {demo.accounts.map((a, i) => {
              const style = ROLE_STYLE[a.role] ?? ROLE_STYLE["Other tenant"];
              const Icon = style.icon;
              return (
                <li
                  key={a.email}
                  className={cn("animate-fade-up", i === demo.accounts.length - 1 && demo.accounts.length % 2 === 1 && "sm:col-span-2")}
                  style={{ animationDelay: `${120 + i * 60}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => signInAs(a.email)}
                    className="lift group flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-card hover:border-ink/20"
                    aria-label={`Sign in as ${a.name}, ${a.role}: ${a.can}`}
                  >
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br", style.tint)}>
                      <Icon className="size-4.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-ink">{a.role}</span>
                      <span className="block text-[12px] leading-snug text-ink-3">{a.can}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-ink-3 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-center text-[12px] text-ink-3">
            Synthetic factory. Shared password: <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">{demo.password}</code>
          </p>
        </section>
      ) : null}
    </>
  );
}
