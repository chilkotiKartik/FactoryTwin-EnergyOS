"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { HeatForm, type HeatFormDefaults } from "./heat-form";

export function NewHeatButton({ defaults, capacityKg, disabled }: { defaults: HeatFormDefaults; capacityKg: number; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  if (disabled) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Log a heat"
      description="Heat number, charge and start are enough. Energy comes from the meter."
      wide
      trigger={
        <Button>
          <Plus /> Log heat
        </Button>
      }
    >
      <HeatForm defaults={defaults} capacityKg={capacityKg} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

export function EditHeatButton({ defaults, capacityKg, heatId, revision }: { defaults: HeatFormDefaults; capacityKg: number; heatId: string; revision: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} title={`Edit heat ${defaults.heatNo}`} description="Changes are versioned and recorded in the audit log." wide trigger={<Button variant="secondary">Edit heat</Button>}>
      <HeatForm defaults={defaults} capacityKg={capacityKg} heatId={heatId} revision={revision} onDone={() => setOpen(false)} />
    </Dialog>
  );
}
