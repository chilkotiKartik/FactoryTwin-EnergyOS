import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "./logo";

const LOOP = [
  "Link meter energy to each heat",
  "Explain overruns from the trace",
  "Optimise start times within limits",
  "Supervisor approves or rejects",
  "Record the outcome",
  "Verify against a stated baseline",
];

/** Split layout for sign in and register: product story on the left, the form on the right. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="bg-blueprint relative hidden flex-col justify-between overflow-hidden p-10 text-shell-ink lg:flex">
        <Logo />
        <div className="max-w-lg">
          <p className="text-eyebrow font-semibold uppercase text-amber-mark">Challenge 04 · Smart Manufacturing</p>
          <p className="mt-3 text-headline font-semibold text-white">Know what every heat should have used, and plan the next shift around it.</p>
          <ol className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
            {LOOP.map((s, i) => (
              <li key={s} className="flex gap-2.5">
                <span className="num mt-px text-[12px] font-semibold text-shell-muted">{String(i + 1).padStart(2, "0")}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="max-w-lg text-[12px] text-shell-muted">
          Recommendation only. Nothing in this application sends commands to plant equipment. Demonstration factories run on synthetic data and are labelled as such everywhere.
        </p>
      </section>
      <section className="flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-control text-[13px] text-ink-2 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Home
          </Link>
          <span className="lg:hidden">
            <Logo tone="light" />
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm animate-fade-up">{children}</div>
        </div>
      </section>
    </main>
  );
}
