"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
  wide,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  trigger?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <D.Trigger asChild>{trigger}</D.Trigger> : null}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-ink/40 data-[state=open]:animate-[fadeIn_120ms_ease-out]" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[92dvh] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface shadow-2xl data-[state=open]:animate-[popIn_160ms_ease-out]",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-[16px] font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[13px] text-ink-3">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
