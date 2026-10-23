"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { createHeatAction, updateHeatAction } from "@/app/actions";
import { heatInputSchema } from "@/lib/schemas/heat";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

type FormIn = z.input<typeof heatInputSchema>;
type FormOut = z.output<typeof heatInputSchema>;

export interface HeatFormDefaults {
  heatNo: string;
  grade: string;
  orderCode: string;
  chargeKg: number | null;
  pouredKg: number | null;
  startAt: string;
  tapAt: string;
  mouldSet: number | null;
  mouldReadyAt: string;
  manualKwh: number | null;
  operatorNotes: string;
}

/**
 * Quick heat entry for a shared tablet: three required fields (heat number,
 * charge, start), large targets, the rest optional. The meter supplies energy.
 */
export function HeatForm({ defaults, capacityKg, heatId, revision, onDone }: { defaults: HeatFormDefaults; capacityKg: number; heatId?: string; revision?: number; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [more, setMore] = useState(Boolean(heatId));
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(heatInputSchema),
    defaultValues: {
      ...defaults,
      chargeKg: defaults.chargeKg ?? undefined,
      pouredKg: defaults.pouredKg ?? undefined,
      mouldSet: defaults.mouldSet ?? undefined,
      manualKwh: defaults.manualKwh ?? undefined,
    },
  });

  const onSubmit = (values: FormOut) =>
    start(async () => {
      const res = heatId ? await updateHeatAction(heatId, revision ?? 1, values) : await createHeatAction(values);
      if (!res.ok) {
        if (res.fieldErrors) for (const [k, v] of Object.entries(res.fieldErrors)) setError(k as keyof FormIn, { message: v });
        toast.error(res.message ?? "Could not save the heat.");
        return;
      }
      toast.success(heatId ? "Heat updated. Energy and anomalies recalculated." : "Heat logged. The meter supplies its energy.");
      onDone?.();
      router.refresh();
    });

  const num = { setValueAs: (v: string) => (v === "" || v === null ? undefined : Number(v)) };
  const err = (k: keyof FormIn) => errors[k]?.message as string | undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Heat number *" htmlFor="heatNo" error={err("heatNo")}>
          <Input id="heatNo" className="h-11 text-base" autoFocus={!heatId} aria-invalid={Boolean(errors.heatNo)} {...register("heatNo")} />
        </Field>
        <Field label="Charge, kg *" htmlFor="chargeKg" error={err("chargeKg")} hint={`Capacity ${capacityKg} kg`}>
          <Input id="chargeKg" type="number" inputMode="decimal" step="1" className="h-11 text-base" aria-invalid={Boolean(errors.chargeKg)} {...register("chargeKg", num)} />
        </Field>
        <Field label="Start *" htmlFor="startAt" error={err("startAt")}>
          <Input id="startAt" type="datetime-local" className="h-11 text-base" aria-invalid={Boolean(errors.startAt)} {...register("startAt")} />
        </Field>
        <Field label="Tap" htmlFor="tapAt" error={err("tapAt")}>
          <Input id="tapAt" type="datetime-local" className="h-11 text-base" aria-invalid={Boolean(errors.tapAt)} {...register("tapAt")} />
        </Field>
        <Field label="Poured, kg" htmlFor="pouredKg" error={err("pouredKg")} hint="Required once tapped">
          <Input id="pouredKg" type="number" inputMode="decimal" className="h-11 text-base" aria-invalid={Boolean(errors.pouredKg)} {...register("pouredKg", num)} />
        </Field>
        <Field label="Mould set" htmlFor="mouldSet" error={err("mouldSet")}>
          <Input id="mouldSet" type="number" inputMode="numeric" className="h-11 text-base" {...register("mouldSet", num)} />
        </Field>
      </div>
      {more ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Mould ready at" htmlFor="mouldReadyAt" error={err("mouldReadyAt")}>
            <Input id="mouldReadyAt" type="datetime-local" {...register("mouldReadyAt")} />
          </Field>
          <Field label="Grade" htmlFor="grade" error={err("grade")}>
            <Input id="grade" {...register("grade")} />
          </Field>
          <Field label="Order" htmlFor="orderCode" error={err("orderCode")}>
            <Input id="orderCode" {...register("orderCode")} />
          </Field>
          <Field label="Manual energy, kWh" htmlFor="manualKwh" error={err("manualKwh")} hint="Only if the meter was down. Meter data wins when present." className="sm:col-span-1">
            <Input id="manualKwh" type="number" inputMode="decimal" {...register("manualKwh", num)} />
          </Field>
          <Field label="Operator notes" htmlFor="operatorNotes" error={err("operatorNotes")} className="sm:col-span-2">
            <Textarea id="operatorNotes" rows={2} {...register("operatorNotes")} />
          </Field>
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="self-start text-[13px] font-medium text-blue hover:underline">
          More fields (mould ready time, grade, order, notes)
        </button>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {heatId ? "Save changes" : "Log heat"}
        </Button>
      </div>
    </form>
  );
}
