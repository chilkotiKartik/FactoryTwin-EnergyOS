import Link from "next/link";
import { Logo } from "./logo";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/#simulator", label: "Simulator" },
  { href: "/how-it-works", label: "How it works" },
];

/** Header and footer shared by the public pages (landing, how it works, sign in, register). */
export function PublicShell({ children, signedIn, tone = "dark" }: { children: React.ReactNode; signedIn: boolean; tone?: "dark" | "light" }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className={cn("sticky top-0 z-40 border-b backdrop-blur", tone === "dark" ? "border-white/10 bg-shell/90 text-shell-ink" : "border-line bg-canvas/90 text-ink-2")}>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo tone={tone} compact />
          <nav aria-label="Main" className="flex items-center gap-1 whitespace-nowrap text-[14px]">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn("hidden rounded-control px-3 py-1.5 sm:inline-block", tone === "dark" ? "hover:bg-white/10 hover:text-white" : "hover:bg-surface-3 hover:text-ink")}
              >
                {n.label}
              </Link>
            ))}
            {signedIn ? (
              <Link href="/dashboard" className="ml-1 rounded-control bg-amber-mark px-3 py-1.5 font-medium text-white hover:bg-amber">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className={cn("rounded-control px-3 py-1.5", tone === "dark" ? "hover:bg-white/10 hover:text-white" : "hover:bg-surface-3 hover:text-ink")}>
                  Sign in
                </Link>
                <Link href="/register" className="ml-1 rounded-control bg-amber-mark px-3 py-1.5 font-medium text-white hover:bg-amber">
                  Try it free
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-[12px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Recommendation only. Nothing in this application sends commands to plant equipment.</p>
          <p>Yuva Yodha Energy Tech Hackathon 2026 · Challenge 04 · Smart Manufacturing</p>
        </div>
      </footer>
    </div>
  );
}
