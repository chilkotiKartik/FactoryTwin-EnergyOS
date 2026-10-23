import { Badge, type Tone } from "@/components/ui/badge";

const TONE: Record<string, Tone> = { PENDING: "amber", APPROVED: "teal", REJECTED: "red", STALE: "neutral", SUPERSEDED: "neutral" };
const TEXT: Record<string, string> = { PENDING: "Awaiting decision", APPROVED: "Approved", REJECTED: "Rejected", STALE: "Stale: inputs changed", SUPERSEDED: "Superseded" };

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? "neutral"}>{TEXT[status] ?? status}</Badge>;
}
