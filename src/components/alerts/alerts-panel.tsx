"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { sendTestAlertAction, setWebhookAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export function WebhookForm({ current, canEdit }: { current: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  if (!canEdit) return <p className="text-ink-3">{current ? `Alerts are sent to ${new URL(current).host}.` : "No alert webhook is configured."}</p>;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const url = String(new FormData(e.currentTarget).get("url") ?? "");
        start(async () => {
          const r = await setWebhookAction(url || null);
          if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not save.");
          setSecret(r.data.secret);
          toast.success(url ? "Webhook saved." : "Webhook removed.");
          router.refresh();
        });
      }}
    >
      <Input name="url" type="url" defaultValue={current ?? ""} placeholder="https://hooks.example.com/energyos" aria-label="Webhook URL" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Save
        </Button>
        {current ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await sendTestAlertAction();
                if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not send.");
                if (r.data.delivered) toast.success("Test alert delivered.");
                else toast.error(`Not delivered: ${r.data.error ?? "unknown error"}`);
                router.refresh();
              })
            }
          >
            Send test alert
          </Button>
        ) : null}
      </div>
      {secret ? (
        <div className="rounded-md border border-amber/30 bg-amber-soft p-2 text-[12px]">
          <p className="mb-1 font-medium text-amber">Signing secret (shown once). Verify the X-EnergyOS-Signature header: HMAC-SHA256 of “timestamp.body”.</p>
          <code className="break-all font-mono">{secret}</code>
        </div>
      ) : null}
    </form>
  );
}
