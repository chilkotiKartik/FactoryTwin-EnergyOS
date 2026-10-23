"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FlaskConical, Loader2, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { createVerificationAction, recordOutcomeAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function RecordOutcomeButton({ planId, label }: { planId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      disabled={pending}
      data-testid="record-outcome"
      onClick={() =>
        start(async () => {
          const r = await recordOutcomeAction(planId);
          if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not record the outcome.");
          toast.success(`Simulated outcome recorded for ${r.data.day}.`);
          router.push(`/verification?comparison=${r.data.day}`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <FlaskConical />} {label}
    </Button>
  );
}

export function SaveReportButton(props: { baselineDay: string; comparisonDay: string; assumptions: { operatingDaysPerYear: number; realisationPct: number; capexInr: number; opexInrPerYear: number } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="teal"
      disabled={pending}
      data-testid="save-report"
      onClick={() =>
        start(async () => {
          const r = await createVerificationAction(props);
          if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not save the report.");
          toast.success("Verification report saved.");
          router.push(`/verification/${r.data}`);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Save />} Save verification report
    </Button>
  );
}

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="no-print">
      <Printer /> Print / save as PDF
    </Button>
  );
}
