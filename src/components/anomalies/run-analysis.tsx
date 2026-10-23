"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { runAnalysisAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function RunAnalysisButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await runAnalysisAction();
          if (!r.ok || !r.data) return void toast.error(r.message ?? "Analysis failed.");
          toast.success(`Analysed ${r.data.heats} heats; ${r.data.flagged} flagged. Model n=${r.data.model.n}, R²=${r.data.model.r2?.toFixed(3) ?? "—"}.`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <ScanSearch />} Re-run analysis
    </Button>
  );
}
