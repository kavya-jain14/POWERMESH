import { describe, expect, it } from "vitest";
import { canonicalizeOfferManifest, type OfferManifest } from "./offers";

const manifest: OfferManifest = {
  version: 1,
  offerId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  nodeId: "33333333-3333-4333-8333-333333333333",
  workload: {
    name: "image-resize",
    version: "1.0.0",
    imageDigest: `sha256:${"a".repeat(64)}`,
  },
  resources: {
    cpu: 1,
    memoryMb: 256,
    timeoutSeconds: 60,
    maxOutputBytes: 10 * 1024 * 1024,
    networkMode: "OFFLINE",
    allowedHosts: [],
    needsHostMount: false,
    privileged: false,
    dockerSocket: false,
    deviceAccess: false,
    arbitraryImage: false,
  },
  params: { width: "128", height: "128" },
  inputDigests: [],
  riskTier: "LOW",
  nonce: "b".repeat(64),
  issuedAt: "2026-10-10T08:00:00.000Z",
  expiresAt: "2026-10-10T08:02:00.000Z",
};

describe("offer manifest canonicalization", () => {
  it("produces the same payload regardless of parameter insertion order", () => {
    const reordered = {
      ...manifest,
      params: { height: "128", width: "128" },
    };

    expect(canonicalizeOfferManifest(reordered)).toBe(canonicalizeOfferManifest(manifest));
  });
});
