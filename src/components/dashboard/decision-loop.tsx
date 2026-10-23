"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, CircleDashed, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Evidence } from "@/components/ui/badge";

export interface Stage {
  key: string;
  title: string;
  metric: string;
  detail: string;
  state: "done" | "attention" | "blocked" | "waiting";
  href: string;
  evidence?: string;
}

const STATE = {
  done: { icon: CheckCircle2, cls: "text-teal", ring: "border-teal/40", label: "Done" },
  attention: { icon: TriangleAlert, cls: "text-amber", ring: "border-amber-mark/50", label: "Needs attention" },
  blocked: { icon: OctagonAlert, cls: "text-red", ring: "border-red/40", label: "Blocked" },
  waiting: { icon: CircleDashed, cls: "text-ink-3", ring: "border-line", label: "Not reached" },
} as const;

/**
 * Signature view: the seven steps from meter reading to verified outcome, each
 * driven by persisted records. Progress reflects what has actually happened.
 */
export function DecisionLoop({ stages }: { stages: Stage[] }) {
  const reduce = useReducedMotion();
  const reached = stages.reduce((acc, s, i) => (s.state !== "waiting" ? i : acc), -1);
  const progress = stages.length > 1 ? Math.max(0, reached) / (stages.length - 1) : 0;
  return (
    <div className="relative">
      <div className="absolute left-[7%] right-[7%] top-[22px] hidden h-0.5 bg-line xl:block" aria-hidden>
        <motion.div className="h-full origin-left bg-ink" initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: progress }} transition={{ duration: 0.9, ease: "easeOut" }} />
      </div>
      <ol className="relative grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {stages.map((s, i) => {
          const st = STATE[s.state];
          const Icon = st.icon;
          return (
            <motion.li
              key={s.key}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: reduce ? 0 : 0.08 * i }}
            >
              <Link
                href={s.href}
                className={cn("group flex h-full flex-col gap-1.5 rounded-lg border bg-surface p-3 transition-shadow hover:shadow-md focus-visible:shadow-md", st.ring)}
                aria-label={`Step ${i + 1}, ${s.title}: ${s.metric}. ${st.label}.`}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("grid size-6 place-items-center rounded-full border bg-surface text-[11px] font-semibold num", s.state === "waiting" ? "border-line text-ink-3" : "border-ink text-ink")}>{i + 1}</span>
                  <Icon className={cn("size-4", st.cls)} aria-hidden />
                  <span className="sr-only">{st.label}</span>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{s.title}</p>
                <p className="num text-[14px] font-semibold leading-snug text-ink">{s.metric}</p>
                <p className="text-[12px] leading-snug text-ink-3">{s.detail}</p>
                {s.evidence && s.evidence !== "NO_DATA" ? <Evidence label={s.evidence} className="mt-auto self-start" /> : null}
              </Link>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
