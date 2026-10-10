import { z } from "zod";

export const auditEventTypes = [
  "JOB_SUBMITTED",
  "JOB_REJECTED",
  "JOB_STATE_CHANGED",
  "OFFER_CREATED",
  "OFFER_APPROVED",
  "OFFER_AUTO_APPROVED",
  "OFFER_DECLINED",
  "OFFER_EXPIRED",
  "JOB_STOPPED",
  "LEASE_EXPIRED",
  "NODE_CONNECTED",
  "NODE_DISCONNECTED",
  "POLICY_UPDATED",
  "ARTIFACT_VALIDATED",
  "NETWORK_REVOKED",
  "TERMINATION_REQUESTED",
  "PROCESS_KILLED",
  "WORKSPACE_CLEANED",
] as const;

export const auditEventTypeSchema = z.enum(auditEventTypes);

export const networkHealthReasonCodes = [
  "OK",
  "RECENT_LEASE_EXPIRY",
  "NO_PROVIDERS",
  "OPEN_INCIDENT",
] as const;

export const networkHealthSchema = z.object({
  status: z.enum(["healthy", "degraded", "no_providers", "incident"]),
  reasonCode: z.enum(networkHealthReasonCodes),
  reason: z.string().trim().min(1).max(500),
  coordinator: z.enum(["online", "degraded"]),
  nodes: z.object({
    total: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    busy: z.number().int().nonnegative(),
    offline: z.number().int().nonnegative(),
    paused: z.number().int().nonnegative(),
  }),
  activeJobs: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  incident: z
    .object({
      id: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      startedAt: z.string().datetime({ offset: true }),
    })
    .optional(),
  checkedAt: z.string().datetime({ offset: true }),
});

export const userRoles = ["requester", "provider", "admin"] as const;
export const userRoleSchema = z.enum(userRoles);

export const meViewSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().trim().min(1).max(100),
    roles: z.array(userRoleSchema).min(1),
    activeRole: userRoleSchema,
  })
  .refine(({ roles, activeRole }) => roles.includes(activeRole), {
    path: ["activeRole"],
    message: "activeRole must be one of the user's roles",
  });

export type AuditEventType = z.infer<typeof auditEventTypeSchema>;
export type NetworkHealth = z.infer<typeof networkHealthSchema>;
export type MeView = z.infer<typeof meViewSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
