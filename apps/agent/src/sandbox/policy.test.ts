import type { SignedJobOffer } from "@powermesh/contracts";
import { describe, expect, it } from "vitest";
import { sandboxJobFromVerifiedOffer } from "./policy";
import type { RuntimeCapability } from "./runtime-probe";

const offer: SignedJobOffer = {
  id: "11111111-1111-4111-8111-111111111111",
  manifest: {
    version: 1,
    offerId: "11111111-1111-4111-8111-111111111111",
    jobId: "22222222-2222-4222-8222-222222222222",
    nodeId: "33333333-3333-4333-8333-333333333333",
    workload: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "worker",
      version: "1",
      imageDigest: `sha256:${"a".repeat(64)}`,
      imageReference: `ghcr.io/powermesh/worker@sha256:${"a".repeat(64)}`,
    },
    resources: {
      cpu: 1,
      memoryMb: 256,
      timeoutSeconds: 60,
      maxOutputBytes: 1024,
      networkMode: "OFFLINE",
      allowedHosts: [],
      needsHostMount: false,
      privileged: false,
      dockerSocket: false,
      deviceAccess: false,
      arbitraryImage: false,
    },
    params: {},
    inputDigests: [],
    riskTier: "LOW",
    nonce: "b".repeat(64),
    issuedAt: "2026-10-10T08:00:00.000Z",
    expiresAt: "2026-10-10T08:02:00.000Z",
  },
  signature: "x".repeat(32),
  signatureAlgorithm: "Ed25519",
  keyId: "trusted-key",
  approvedAt: null,
  claimedAt: null,
  leaseUntil: null,
};

const rootless: RuntimeCapability = {
  dockerAvailable: true,
  rootless: true,
  isolationLevels: ["CONTAINER_BASELINE"],
  reasons: [],
};

describe("sandbox policy", () => {
  it("maps a verified low-risk offer into fixed sandbox limits", () => {
    const job = sandboxJobFromVerifiedOffer(offer, rootless);
    expect(job.image).toBe(offer.manifest.workload.imageReference);
    expect(job.limits).toMatchObject({ cpu: 1, memoryMb: 256, pids: 128, maxOutputBytes: 1024 });
  });

  it("requires rootless Docker and gVisor for medium-risk work", () => {
    expect(() => sandboxJobFromVerifiedOffer(offer, { ...rootless, rootless: false })).toThrow(
      /ROOTLESS/,
    );
    const medium = { ...offer, manifest: { ...offer.manifest, riskTier: "MEDIUM" as const } };
    expect(() => sandboxJobFromVerifiedOffer(medium, rootless)).toThrow(/GVISOR/);
    expect(
      sandboxJobFromVerifiedOffer(medium, {
        ...rootless,
        isolationLevels: ["CONTAINER_BASELINE", "GVISOR"],
      }).isolation,
    ).toBe("GVISOR");
  });
});
