"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { addMemberAction, changeRoleAction, removeMemberAction, resetPasswordAction, setDisabledAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

type Role = "OWNER" | "SUPERVISOR" | "OPERATOR" | "ANALYST";
const ROLES: { v: Role; l: string }[] = [
  { v: "OWNER", l: "Owner" },
  { v: "SUPERVISOR", l: "Supervisor" },
  { v: "ANALYST", l: "Analyst" },
  { v: "OPERATOR", l: "Operator" },
];

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
}

function OneTime({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-amber/30 bg-amber-soft p-2 text-[12px]">
      <p className="mb-1 font-medium text-amber">{label} Shown once; they must change it at first sign-in.</p>
      <code className="break-all font-mono">{value}</code>
    </div>
  );
}

export function TeamPanel({ members, selfId, canManage }: { members: Member[]; selfId: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; data?: unknown }>, done?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message ?? "Could not save.");
      if (done) toast.success(done);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <ul className="flex flex-col divide-y divide-line">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-col gap-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium">{m.name}</span> <span className="break-all text-ink-3">{m.email}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                {m.disabled ? <Badge tone="red">disabled</Badge> : null}
                {m.mustChangePassword ? <Badge tone="amber">one-time password</Badge> : null}
              </span>
            </div>
            {canManage && m.userId !== selfId ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label={`Role of ${m.name}`} value={m.role} disabled={pending} onChange={(e) => run(() => changeRoleAction(m.userId, e.target.value), "Role changed.")} className="h-8 w-36">
                  {ROLES.map((r) => (
                    <option key={r.v} value={r.v}>
                      {r.l}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setDisabledAction(m.userId, !m.disabled), m.disabled ? "Account enabled." : "Account disabled; sessions ended.")}>
                  {m.disabled ? "Enable" : "Disable"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await resetPasswordAction(m.userId);
                      if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not reset.");
                      setSecret({ label: `New password for ${m.email}:`, value: r.data.tempPassword });
                      router.refresh();
                    })
                  }
                >
                  Reset password
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Remove ${m.name} from this factory?`)) run(() => removeMemberAction(m.userId), "Removed.");
                  }}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <span className="text-ink-3">{ROLES.find((r) => r.v === m.role)?.l}</span>
            )}
          </li>
        ))}
      </ul>
      {secret ? <OneTime label={secret.label} value={secret.value} /> : null}
      {canManage ? (
        <form
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const form = e.currentTarget;
            start(async () => {
              const r = await addMemberAction({ name: fd.get("name"), email: fd.get("email"), role: fd.get("role") });
              if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not add.");
              form.reset();
              if (r.data.tempPassword) setSecret({ label: `Password for ${String(fd.get("email"))}:`, value: r.data.tempPassword });
              else toast.success("Existing account added to this factory.");
              router.refresh();
            });
          }}
        >
          <p className="font-medium">Add a member</p>
          <Input name="name" placeholder="Name" aria-label="Name" required />
          <Input name="email" type="email" placeholder="Email" aria-label="Email" required />
          <div className="flex gap-2">
            <Select name="role" aria-label="Role" defaultValue="OPERATOR" className="flex-1">
              {ROLES.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.l}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" disabled={pending}>
              <UserPlus /> Add
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
