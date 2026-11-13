"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { localTime } from "@/lib/format";

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** Create, list and revoke read-only integration keys. A new key is shown once. */
export function ApiKeys({ keys, timeZone }: { keys: ApiKeyRow[]; timeZone: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createApiKeyAction(name);
            if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not create the key.");
            setFresh(r.data.key);
            setName("");
            router.refresh();
          });
        }}
      >
        <label htmlFor="api-key-name" className="sr-only">
          Key name
        </label>
        <Input id="api-key-name" placeholder="Who will use it, e.g. Power BI, ERP" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" variant="secondary" disabled={pending || name.trim().length < 2}>
          {pending ? <Loader2 className="animate-spin" /> : <KeyRound />} Create key
        </Button>
      </form>
      {fresh ? (
        <div className="rounded-lg border border-amber/30 bg-amber-soft p-2.5 text-[12px]">
          <p className="mb-1 font-medium text-amber">Copy this key now. It is shown once and stored only as a hash.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono">{fresh}</code>
            <Button size="icon" variant="ghost" aria-label="Copy key" onClick={() => void navigator.clipboard.writeText(fresh).then(() => toast.success("Copied."))}>
              <Copy />
            </Button>
          </div>
        </div>
      ) : null}
      {keys.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{k.name}</span> <code className="font-mono text-[11.5px] text-ink-3">{k.prefix}…</code>
                <span className="block text-[11.5px] text-ink-3">
                  Created {localTime(k.createdAt, timeZone, true)} · last used {k.lastUsedAt ? localTime(k.lastUsedAt, timeZone, true) : "never"}
                </span>
              </span>
              {k.revokedAt ? (
                <Badge>revoked</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      if (!confirm(`Revoke "${k.name}"? Systems using it stop working at once.`)) return;
                      const r = await revokeApiKeyAction(k.id);
                      if (!r.ok) return void toast.error(r.message ?? "Could not revoke.");
                      toast.success("Key revoked.");
                      router.refresh();
                    })
                  }
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-3">No keys yet.</p>
      )}
      <pre className="overflow-x-auto rounded-lg bg-shell p-3 font-mono text-[11px] leading-relaxed text-shell-ink">{`curl -H "Authorization: Bearer eosk_…" \\
  "$APP_URL/api/v1/summary?from=2026-10-01&to=2026-10-31"`}</pre>
      <p className="text-ink-3">
        Read-only. Endpoints: <code className="font-mono">/api/v1/summary</code>, <code className="font-mono">/heats</code>, <code className="font-mono">/recommendations</code>, <code className="font-mono">/market</code>. Full description:{" "}
        <a className="font-medium text-blue hover:underline" href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">
          OpenAPI
        </a>
        . 600 calls per minute per key.
      </p>
    </div>
  );
}
