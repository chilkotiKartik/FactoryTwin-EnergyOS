"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { setAnomalyStatusAction } from "@/app/actions";

export function AnomalyStatus({ id, status }: { id: string; status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[12px] text-ink-3">
      Status
      <select
        value={status}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const r = await setAnomalyStatusAction(id, e.target.value as typeof status);
            if (!r.ok) toast.error(r.message);
            else {
              toast.success("Anomaly status updated.");
              router.refresh();
            }
          })
        }
        className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[12px] text-ink"
      >
        <option value="OPEN">Open</option>
        <option value="ACKNOWLEDGED">Acknowledged</option>
        <option value="RESOLVED">Resolved</option>
      </select>
    </label>
  );
}
