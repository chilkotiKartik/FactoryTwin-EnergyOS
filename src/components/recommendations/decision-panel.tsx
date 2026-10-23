"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { decideAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";

/**
 * Approve / reject. The server re-checks role, tenant, version and input freshness;
 * these buttons are a convenience, not the security boundary.
 */
export function DecisionPanel({ recommendationId, version, summary }: { recommendationId: string; version: number; summary: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<null | "APPROVED" | "REJECTED">(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "APPROVED" | "REJECTED">(null);

  function submit(decision: "APPROVED" | "REJECTED") {
    setError(null);
    start(async () => {
      const r = await decideAction({ recommendationId, decision, reason, expectedVersion: version });
      if (!r.ok) {
        setError(r.fieldErrors?.reason ?? r.message ?? "Could not record the decision.");
        if (r.code === "STALE" || r.code === "CONFLICT") {
          toast.error(r.message ?? "This recommendation can no longer be decided.");
          setMode(null);
          router.refresh();
        }
        return;
      }
      setMode(null);
      setDone(decision);
      toast.success(decision === "APPROVED" ? "Approved. The recommended schedule is now the active plan record." : "Rejected. Current practice stays in place.");
      setTimeout(() => router.refresh(), reduce ? 0 : 900);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div
            key="done"
            initial={reduce ? false : { scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 ${done === "APPROVED" ? "bg-teal-soft text-teal" : "bg-surface-3 text-ink-2"}`}
            role="status"
          >
            <motion.span initial={reduce ? false : { rotate: -90 }} animate={{ rotate: 0 }} className={`grid size-8 place-items-center rounded-full ${done === "APPROVED" ? "bg-teal text-white" : "bg-ink-3 text-white"}`}>
              {done === "APPROVED" ? <Check className="size-4" /> : <X className="size-4" />}
            </motion.span>
            <span className="font-semibold">{done === "APPROVED" ? "Decision recorded: approved" : "Decision recorded: rejected"}</span>
          </motion.div>
        ) : (
          <motion.div key="buttons" exit={{ opacity: 0 }} className="flex flex-wrap gap-2">
            <Button variant="teal" size="lg" onClick={() => (setReason(""), setError(null), setMode("APPROVED"))} data-testid="approve">
              <Check /> Approve
            </Button>
            <Button variant="secondary" size="lg" onClick={() => (setReason(""), setError(null), setMode("REJECTED"))} data-testid="reject">
              <X /> Reject
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="text-[12px] text-ink-3">Approval records a plan decision only. EnergyOS never sends commands to the furnace or any equipment.</p>

      <Dialog open={mode !== null} onOpenChange={(v) => !v && setMode(null)} title={mode === "APPROVED" ? `Approve recommendation v${version}?` : `Reject recommendation v${version}`} description={summary}>
        <div className="flex flex-col gap-3">
          <label htmlFor="decision-reason" className="text-[12px] font-medium text-ink-2">
            {mode === "REJECTED" ? "Reason for rejecting (required)" : "Note (optional)"}
          </label>
          <Textarea id="decision-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-invalid={!!error} placeholder={mode === "REJECTED" ? "e.g. Mould line short-staffed before 10:00" : "e.g. Shift lead informed"} />
          {error ? (
            <p role="alert" className="text-[13px] text-red">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant={mode === "APPROVED" ? "teal" : "danger"} disabled={pending} onClick={() => mode && submit(mode)} data-testid="confirm-decision">
              {pending ? <Loader2 className="animate-spin" /> : null}
              {mode === "APPROVED" ? "Confirm approval" : "Confirm rejection"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
