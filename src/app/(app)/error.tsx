"use client";

import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="This page could not be loaded"
      action={
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      }
    >
      Nothing was changed. If it keeps happening, give your administrator this
      reference: {error.digest ?? "n/a"}.
    </EmptyState>
  );
}
