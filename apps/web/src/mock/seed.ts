/**
 * Seed data for the mock coordinator. Non-personal, fixture-only identities and node labels.
 * No real paths, addresses, secrets or credentials (master plan §7 fresh-start rules).
 */
import type { ProviderNode, ProviderPolicy, Role } from "@/contracts-draft/types";

const MB = 1024 * 1024;
const GB = 1024 * MB;
/** Fixture community time zone (Q13: schedules use the provider's configured zone, never the browser's). */
const TIMEZONE = "Asia/Kolkata";

export interface MockUser {
  id: string;
  role: Role;
  label: string;
}

export const USERS: Record<Role, MockUser> = {
  requester: { id: "u_req_1", role: "requester", label: "Demo requester" },
  provider: { id: "u_prov_1", role: "provider", label: "Demo provider" },
  admin: { id: "u_admin_1", role: "admin", label: "Community admin" },
};

export const PROVIDER_NODE_ID = "node_lab_01";

export function seedNodes(now: number): ProviderNode[] {
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  return [
    {
      id: PROVIDER_NODE_ID,
      ownerId: USERS.provider.id,
      ownerLabel: USERS.provider.label,
      label: "lab-linux-01",
      os: "linux",
      arch: "amd64",
      agentVersion: "0.1.0",
      trustTier: "community",
      heartbeatAt: iso(0),
      status: "available",
      capability: {
        runtime: "docker-rootless",
        cpuCores: 4,
        memoryBytes: 8 * GB,
        diskBytes: 20 * GB,
        accelerator: "none",
        networkModes: ["OFFLINE"],
        isolation: {
          declared: ["docker-rootless", "gvisor"],
          verified: ["docker-rootless", "gvisor"],
          probeStatus: "verified",
          probedAt: iso(4 * 60_000),
        },
      },
    },
    {
      id: "node_mac_02",
      ownerId: "u_prov_2",
      ownerLabel: "Community member",
      label: "studio-mac-02",
      os: "macos",
      arch: "arm64",
      agentVersion: "0.1.0",
      trustTier: "community",
      heartbeatAt: iso(3 * 3600_000),
      status: "offline",
      capability: {
        runtime: "docker-rootless",
        cpuCores: 8,
        memoryBytes: 16 * GB,
        diskBytes: 40 * GB,
        accelerator: "none",
        networkModes: ["OFFLINE"],
        // Offline since it was enrolled: the Agent hasn't probed isolation yet, so nothing counts (Q11).
        isolation: {
          declared: ["docker-rootless"],
          verified: [],
          probeStatus: "pending",
          probedAt: null,
        },
      },
    },
    {
      id: "node_win_03",
      ownerId: "u_prov_3",
      ownerLabel: "Community member",
      label: "desk-win-03",
      os: "windows",
      arch: "amd64",
      agentVersion: "0.1.0",
      trustTier: "community",
      heartbeatAt: iso(40_000),
      status: "paused",
      capability: {
        runtime: "docker-rootless",
        cpuCores: 6,
        memoryBytes: 16 * GB,
        diskBytes: 30 * GB,
        accelerator: "none",
        networkModes: ["OFFLINE"],
        // Declared but the Agent probe failed — the UI must not claim any isolation is active.
        isolation: {
          declared: ["docker-rootless", "gvisor"],
          verified: [],
          probeStatus: "failed",
          probedAt: iso(40_000),
          failureCode: "ROOTLESS_REQUIRED",
        },
      },
    },
  ];
}

export function seedPolicies(now: number): ProviderPolicy[] {
  const updatedAt = new Date(now - 86400_000).toISOString();
  return [
    {
      nodeId: PROVIDER_NODE_ID,
      allowedWorkloads: ["image-transform"],
      riskMax: "LOW",
      consentMode: "ask",
      schedule: { mode: "always", timezone: TIMEZONE },
      networkModes: ["OFFLINE"],
      resourceCaps: {
        cpuCores: 2,
        memoryBytes: 2 * GB,
        diskBytes: 5 * GB,
        timeoutSeconds: 900,
        pidLimit: 128,
        maxOutputBytes: 100 * MB,
      },
      updatedAt,
    },
    {
      nodeId: "node_mac_02",
      allowedWorkloads: ["image-transform"],
      riskMax: "LOW",
      consentMode: "auto",
      schedule: { mode: "window", start: "18:00", end: "08:00", timezone: TIMEZONE },
      networkModes: ["OFFLINE"],
      resourceCaps: {
        cpuCores: 4,
        memoryBytes: 4 * GB,
        diskBytes: 10 * GB,
        timeoutSeconds: 1800,
        pidLimit: 256,
        maxOutputBytes: 200 * MB,
      },
      updatedAt,
    },
    {
      nodeId: "node_win_03",
      allowedWorkloads: ["image-transform"],
      riskMax: "LOW",
      consentMode: "ask",
      schedule: { mode: "always", timezone: TIMEZONE },
      networkModes: ["OFFLINE"],
      resourceCaps: {
        cpuCores: 2,
        memoryBytes: 2 * GB,
        diskBytes: 5 * GB,
        timeoutSeconds: 900,
        pidLimit: 128,
        maxOutputBytes: 100 * MB,
      },
      updatedAt,
    },
  ];
}

export const SAMPLE_SET_ID = "demo-abstract-v1";
