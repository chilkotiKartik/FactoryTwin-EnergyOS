"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Cpu, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runOptimizationAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Runs the optimiser on the server. The progress strip shows that a request is in flight; it does not invent steps or timings. */
export function RunOptimizerButton({ planId, disabled }: { planId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [last, setLast] = useState<{ message: string; recId: string | null; status: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="amber"
        size="lg"
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            const r = await runOptimizationAction(planId);
            if (!r.ok || !r.data) return void toast.error(r.message ?? "The optimiser could not run.");
            setLast({ message: r.data.message, recId: r.data.recommendationId, status: r.data.status });
            if (r.data.status === "OPTIMAL") toast.success(r.data.message);
            else toast.warning(r.data.message);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Cpu />}
        {pending ? "Solving…" : "Run optimiser"}
      </Button>
      <AnimatePresence>
        {pending ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-1 w-48 overflow-hidden rounded bg-surface-3" role="progressbar" aria-label="Optimiser running">
            <motion.div className="h-full w-1/3 bg-amber-mark" animate={{ x: ["-100%", "300%"] }} transition={{ repeat: Infinity, duration: 0.9, ease: "easeInOut" }} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {last?.recId ? (
        <Link href={`/recommendations/${last.recId}`} className="text-[13px] font-medium text-blue hover:underline">
          Review recommendation →
        </Link>
      ) : null}
    </div>
  );
}
