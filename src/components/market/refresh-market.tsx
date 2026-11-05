"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshMarketAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function RefreshMarket() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await refreshMarketAction();
          if (!r.ok) return void toast.info(r.message ?? "Could not update prices.");
          toast.success(`IEX prices updated for ${r.data?.date}.`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Update
    </Button>
  );
}
