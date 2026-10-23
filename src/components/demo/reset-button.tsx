"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { resetScenarioAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function ResetScenarioButton({ scenarioKey, name, active }: { scenarioKey: string; name: string; active: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Load “${name}”?`}
      description="This replaces this simulation factory's heats, readings, plans, runs, recommendations and reports with freshly generated synthetic data. Users, other factories and the audit log are not touched."
      trigger={
        <Button variant={active ? "secondary" : "primary"} size="sm" data-testid={`load-${scenarioKey}`}>
          <RotateCcw /> {active ? "Reset" : "Load"}
        </Button>
      }
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="amber"
          disabled={pending}
          data-testid="confirm-reset"
          onClick={() =>
            start(async () => {
              const r = await resetScenarioAction(scenarioKey);
              if (!r.ok) return void toast.error(r.message);
              toast.success(`Scenario “${name}” loaded.`);
              setOpen(false);
              router.push("/dashboard");
              router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : null} {pending ? "Generating 32 days…" : "Load scenario"}
        </Button>
      </div>
    </Dialog>
  );
}
