import { describe, expect, it } from "vitest";
import { apiErrorBodySchema, opaqueCursorSchema, pageQuerySchema } from "./api";
import { artifactSchema } from "./artifacts";
import { isolationCapabilitySchema } from "./capabilities";
import { offerCreationSchema } from "./offers";
import { meViewSchema } from "./platform";
import { providerPolicySchema } from "./provider";
import { protocolTiming, terminalFailureSchema } from "./terminal";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

describe("v0 API primitives", () => {
  it("accepts the standard error envelope and all pagination defaults", () => {
    expect(
      apiErrorBodySchema.parse({
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in to continue",
          correlationId: firstId,
        },
      }).error.code,
    ).toBe("UNAUTHENTICATED");
    expect(pageQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(pageQuerySchema.parse({ limit: "100" }).limit).toBe(100);
  });

  it("treats cursors as opaque base64url values", () => {
    expect(opaqueCursorSchema.safeParse("eyJpZCI6IjEyMyJ9").success).toBe(true);
    expect(opaqueCursorSchema.safeParse("not a cursor").success).toBe(false);
  });
});

describe("v0 provider contracts", () => {
  it("requires verified isolation to be declared and positively probed", () => {
    const valid = {
      declared: ["docker-rootless", "gvisor"],
      verified: ["gvisor"],
      probeStatus: "verified",
      probedAt: "2026-10-10T10:00:00.000Z",
    } as const;

    expect(isolationCapabilitySchema.safeParse(valid).success).toBe(true);
    expect(
      isolationCapabilitySchema.safeParse({
        ...valid,
        declared: ["docker-rootless"],
      }).success,
    ).toBe(false);
    expect(isolationCapabilitySchema.safeParse({ ...valid, verified: [] }).success).toBe(false);
  });

  it("validates IANA timezones and permits windows crossing midnight", () => {
    const policy = {
      allowedWorkloads: ["image-transform"],
      riskMax: "MEDIUM",
      consentMode: "ask",
      schedule: {
        mode: "window",
        start: "22:00",
        end: "06:00",
        timezone: "Asia/Kolkata",
      },
      networkModes: ["OFFLINE", "RESTRICTED"],
      resourceCaps: {
        cpuCores: 2,
        memoryBytes: 536_870_912,
        diskBytes: 1_073_741_824,
        timeoutSeconds: 300,
        pidLimit: 64,
        maxOutputBytes: 10_485_760,
      },
    } as const;

    expect(providerPolicySchema.safeParse(policy).success).toBe(true);
    expect(
      providerPolicySchema.safeParse({
        ...policy,
        schedule: { ...policy.schedule, timezone: "Mars/Olympus" },
      }).success,
    ).toBe(false);
    expect(providerPolicySchema.safeParse({ ...policy, networkModes: ["OPEN_WEB"] }).success).toBe(
      false,
    );
  });
});

describe("v0 result and failure contracts", () => {
  const artifact = {
    id: firstId,
    jobId: secondId,
    direction: "output",
    name: "result.webp",
    contentType: "image/webp",
    sizeBytes: 1024,
    digest: `sha256:${"a".repeat(64)}`,
    url: "https://objects.example.test/result",
    urlExpiresAt: "2026-10-10T10:10:00.000Z",
    validation: [{ code: "MIME_ALLOWED", label: "Allowed type", passed: true }],
  } as const;

  it("makes failed artifacts non-downloadable", () => {
    expect(artifactSchema.safeParse(artifact).success).toBe(true);
    expect(
      artifactSchema.safeParse({
        ...artifact,
        validation: [{ code: "MIME_ALLOWED", label: "Allowed type", passed: false }],
      }).success,
    ).toBe(false);
    expect(
      artifactSchema.safeParse({
        ...artifact,
        url: null,
        urlExpiresAt: null,
        validation: [{ code: "MIME_ALLOWED", label: "Allowed type", passed: false }],
      }).success,
    ).toBe(true);
  });

  it("enforces terminal reason codes by terminal state", () => {
    expect(
      terminalFailureSchema.safeParse({
        state: "FAILED",
        code: "OUTPUT_VALIDATION_FAILED",
        reason: "Output validation failed",
      }).success,
    ).toBe(true);
    expect(
      terminalFailureSchema.safeParse({
        state: "CANCELLED",
        code: "OUTPUT_VALIDATION_FAILED",
        reason: "Invalid pairing",
      }).success,
    ).toBe(false);
  });
});

describe("v0 identity and timing", () => {
  it("requires active role membership", () => {
    expect(
      meViewSchema.safeParse({
        id: firstId,
        displayName: "Kavya",
        roles: ["requester"],
        activeRole: "provider",
      }).success,
    ).toBe(false);
  });

  it("uses the frozen TTLs and heartbeat windows", () => {
    expect(offerCreationSchema.parse({ nodeId: firstId }).ttlSeconds).toBe(60);
    expect(protocolTiming).toMatchObject({
      offerTtlSeconds: 60,
      artifactUrlTtlSeconds: 600,
      executionLeaseSeconds: 30,
      leaseExpiryGraceSeconds: 10,
    });
  });
});
