import { describe, expect, it } from "vitest";
import { agentEventBatchSchema, agentHeartbeatResponseSchema } from "./agent-protocol";
import { jobEventSchema } from "./events";
import {
  agentAvailabilityRequestSchema,
  agentLocalStateSchema,
  agentOfferDecisionRequestSchema,
  agentPairRequestSchema,
} from "./local-api";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const now = "2026-10-22T12:00:00.000Z";

describe("realtime protocol contracts", () => {
  it("validates a replayable job event fixture", () => {
    const event = jobEventSchema.parse({
      seq: 7,
      id: firstId,
      jobId: secondId,
      type: "state",
      state: "RUNNING",
      prevState: "STAGING",
      reasonCode: "RUNNING",
      actor: { role: "agent", label: "Provider Agent" },
      at: now,
      correlationId: firstId,
      attempt: 1,
      safePayload: { runtime: "gvisor" },
    });

    expect(event.seq).toBe(7);
    expect(event.safePayload).toEqual({ runtime: "gvisor" });
  });

  it("requires heartbeat responses to carry offers and commands", () => {
    expect(
      agentHeartbeatResponseSchema.parse({
        node: { id: firstId, status: "ONLINE" },
        offers: [],
        commands: [{ type: "CANCEL", jobId: secondId, reason: "REQUESTER_CANCEL" }],
      }).commands,
    ).toHaveLength(1);
  });

  it("validates idempotent Agent event batches", () => {
    const batch = agentEventBatchSchema.parse({
      events: [
        {
          agentSeq: 3,
          jobId: secondId,
          type: "PROGRESS",
          at: now,
          progress: { done: 4, total: 10, unit: "frames" },
          safePayload: {},
        },
      ],
    });

    expect(batch.events[0]?.agentSeq).toBe(3);
  });
});

describe("loopback Agent API contracts", () => {
  it("validates pairing, availability and offer decisions", () => {
    expect(agentPairRequestSchema.safeParse({ code: "428193" }).success).toBe(true);
    expect(agentPairRequestSchema.safeParse({ code: "123" }).success).toBe(false);
    expect(agentAvailabilityRequestSchema.parse({ available: false })).toEqual({
      available: false,
    });
    expect(agentOfferDecisionRequestSchema.parse({ decision: "approve" })).toEqual({
      decision: "approve",
    });
  });

  it("validates the Provider Console state fixture", () => {
    const state = agentLocalStateSchema.parse({
      agent: { version: "0.1.0", startedAt: now },
      coordinator: { reachable: true, lastContactAt: now },
      node: {
        id: firstId,
        ownerId: secondId,
        ownerLabel: "Provider",
        label: "Local workstation",
        os: "linux",
        arch: "amd64",
        agentVersion: "0.1.0",
        trustTier: "community",
        heartbeatAt: now,
        status: "available",
        capability: {
          runtime: "gvisor",
          cpuCores: 8,
          memoryBytes: 16_000_000_000,
          diskBytes: 100_000_000_000,
          accelerator: "none",
          networkModes: ["OFFLINE"],
          isolation: {
            declared: ["gvisor"],
            verified: ["gvisor"],
            probeStatus: "verified",
            probedAt: now,
          },
        },
      },
      policy: {
        nodeId: firstId,
        updatedAt: now,
        allowedWorkloads: ["image-transform"],
        riskMax: "LOW",
        consentMode: "ask",
        schedule: { mode: "always", timezone: "Asia/Kolkata" },
        networkModes: ["OFFLINE"],
        resourceCaps: {
          cpuCores: 2,
          memoryBytes: 4_000_000_000,
          diskBytes: 10_000_000_000,
          timeoutSeconds: 300,
          pidLimit: 64,
          maxOutputBytes: 10_000_000,
        },
      },
      pendingOffer: null,
      activeJob: null,
      lastJob: null,
      stop: null,
    });

    expect(state.node.status).toBe("available");
  });
});
