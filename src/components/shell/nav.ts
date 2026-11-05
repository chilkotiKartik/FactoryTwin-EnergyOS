import {
  BadgeCheck,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  FileText,
  Flame,
  FlaskConical,
  Gauge,
  History,
  IndianRupee,
  LayoutDashboard,
  Lightbulb,
  Settings,
  TriangleAlert,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages";

export interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  /** Extra words the command palette matches on (English, so search works in any UI language). */
  keywords: string;
}
export interface NavGroup {
  title: MessageKey;
  items: NavItem[];
}

export interface NavContext {
  canSeeAudit: boolean;
  isSimulation: boolean;
}

/** The one definition of the app's navigation: sidebar, phone bar and command palette all read it. */
export function navGroups({ canSeeAudit, isSimulation }: NavContext): NavGroup[] {
  return [
    {
      title: "nav.overview",
      items: [
        { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard, keywords: "home kpi overview sec cost energy" },
        { href: "/why", label: "nav.why", icon: Lightbulb, keywords: "why research evidence savings calculator roi benchmark" },
      ],
    },
    {
      title: "nav.operations",
      items: [
        { href: "/heats", label: "nav.heats", icon: Flame, keywords: "heat log charge tap melt entry tablet" },
        { href: "/meters", label: "nav.meters", icon: Gauge, keywords: "meter csv import readings quality gaps ingest" },
        { href: "/anomalies", label: "nav.anomalies", icon: TriangleAlert, keywords: "anomaly variance holding overrun" },
      ],
    },
    {
      title: "nav.decisions",
      items: [
        { href: "/optimizer", label: "nav.optimizer", icon: CalendarClock, keywords: "optimiser optimizer schedule plan what-if run" },
        { href: "/recommendations", label: "nav.approvals", icon: ClipboardCheck, keywords: "approve reject recommendation decision" },
        { href: "/verification", label: "nav.verification", icon: BadgeCheck, keywords: "verify savings baseline payback co2" },
      ],
    },
    {
      title: "nav.records",
      items: [
        { href: "/tariffs", label: "nav.tariffs", icon: IndianRupee, keywords: "tariff tod rate solar peak" },
        { href: "/reports", label: "nav.reports", icon: FileText, keywords: "report export csv daily print" },
        ...(canSeeAudit ? [{ href: "/audit", label: "nav.audit" as const, icon: History, keywords: "audit log chain history" }] : []),
        { href: "/evidence", label: "nav.evidence", icon: BookOpen, keywords: "evidence assumptions sources deck" },
        { href: "/settings", label: "nav.settings", icon: Settings, keywords: "settings factory team token webhook demand cap" },
      ],
    },
    ...(isSimulation ? [{ title: "nav.demo" as const, items: [{ href: "/demo", label: "nav.scenario" as const, icon: FlaskConical, keywords: "demo scenario reset" }] }] : []),
  ];
}

/** Account page is reachable from the palette too. */
export const ACCOUNT_ITEM = { href: "/account", icon: UserCog, keywords: "account password profile" } as const;

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
