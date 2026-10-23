"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createPlanAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/** Minimal plan creation for a real factory: one order, N heats of equal charge. */
export function CreatePlanForm({ defaultDate, capacityKg }: { defaultDate: string; capacityKg: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ planDate: defaultDate, heatsCount: "12", chargeKg: String(capacityKg), orderCode: "", grade: "", deadline: "22:00" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const [h, m] = v.deadline.split(":").map(Number);
        start(async () => {
          const r = await createPlanAction({ planDate: v.planDate, heatsCount: Number(v.heatsCount), chargeKg: Number(v.chargeKg), orderCode: v.orderCode, grade: v.grade, deadlineMin: h * 60 + m });
          if (!r.ok) return void toast.error(r.message);
          toast.success("Plan created. Add mould-ready times, then run the optimiser.");
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Plan date<Input type="date" value={v.planDate} onChange={set("planDate")} required /></label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Heats<Input inputMode="numeric" value={v.heatsCount} onChange={set("heatsCount")} required /></label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Charge per heat (kg)<Input inputMode="numeric" value={v.chargeKg} onChange={set("chargeKg")} required /></label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Order code<Input value={v.orderCode} onChange={set("orderCode")} required /></label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Grade<Input value={v.grade} onChange={set("grade")} required /></label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Dispatch deadline<Input type="time" value={v.deadline} onChange={set("deadline")} required /></label>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null} Create plan</Button>
      </div>
    </form>
  );
}
