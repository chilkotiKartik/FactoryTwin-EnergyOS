"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { verifyAuditAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function VerifyChain() {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await verifyAuditAction();
            setRes(r.ok && r.data ? r.data : { ok: false, message: r.message ?? "Could not verify." });
          })
        }
      >
        {pending ? "Verifying…" : "Verify integrity"}
      </Button>
      {res ? (
        <span role="status" className={`flex items-center gap-1 ${res.ok ? "text-teal" : "text-red"}`}>
          {res.ok ? <ShieldCheck className="size-4" aria-hidden /> : <ShieldAlert className="size-4" aria-hidden />}
          {res.message}
        </span>
      ) : null}
    </div>
  );
}
