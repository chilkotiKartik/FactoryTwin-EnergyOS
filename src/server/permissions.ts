import type { Role } from "@/db/schema";
import { forbidden } from "./errors";

export const PERMISSIONS = [
  "view",
  "heat.write",
  "meter.import",
  "analysis.run",
  "tariff.write",
  "plan.write",
  "optimizer.run",
  "recommendation.decide",
  "outcome.record",
  "verification.create",
  "export",
  "audit.view",
  "factory.configure",
  "demo.reset",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

/**
 * Role matrix. Operators log heats. Analysts prepare analysis, tariffs, plans and
 * runs but cannot approve. Supervisors decide. Owners can do everything.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: ALL,
  SUPERVISOR: new Set<Permission>([
    "view",
    "heat.write",
    "meter.import",
    "analysis.run",
    "plan.write",
    "optimizer.run",
    "recommendation.decide",
    "outcome.record",
    "verification.create",
    "export",
    "audit.view",
    "demo.reset",
  ]),
  ANALYST: new Set<Permission>([
    "view",
    "meter.import",
    "analysis.run",
    "tariff.write",
    "plan.write",
    "optimizer.run",
    "verification.create",
    "export",
    "audit.view",
  ]),
  OPERATOR: new Set<Permission>(["view", "heat.write"]),
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(perm);
}

export function assertCan(role: Role, perm: Permission): void {
  if (!can(role, perm)) throw forbidden(`The ${role.toLowerCase()} role cannot perform “${perm}”.`);
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operator",
  ANALYST: "Analyst",
};
