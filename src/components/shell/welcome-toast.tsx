"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** One-time greeting after sign-up (`?welcome=1`); the flag is then removed from the URL. */
export function WelcomeToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef(false);
  useEffect(() => {
    if (params.get("welcome") !== "1" || shown.current) return;
    shown.current = true;
    toast.success("Your sandbox factory is ready", {
      description: "31 days of synthetic furnace data are loaded. Press Ctrl/⌘ K to jump anywhere.",
      duration: 8000,
    });
    router.replace(pathname, { scroll: false });
  }, [params, router, pathname]);
  return null;
}
