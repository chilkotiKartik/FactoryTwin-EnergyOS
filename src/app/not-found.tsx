import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center">
      <EmptyState
        icon={SearchX}
        title="Not found"
        action={
          <Link
            href="/dashboard"
            className="text-[13px] font-medium text-ink underline"
          >
            Back to the dashboard
          </Link>
        }
      >
        The page or record does not exist, or it belongs to a factory you are
        not signed in to.
      </EmptyState>
    </main>
  );
}
