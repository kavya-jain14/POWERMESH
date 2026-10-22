import { randomBytes, randomUUID } from "node:crypto";
import type { SignedJobOffer } from "@powermesh/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashAgentToken } from "./auth/tokens";
import { createPostgresPool } from "./db/pool";
import { createOfferSigner } from "./offers/signing";
import { PostgresCoordinatorStore } from "./store/postgres";

const connectionString = process.env.DATABASE_URL;
const integration = describe.runIf(Boolean(connectionString));

integration("PostgreSQL coordinator store", () => {
  const pool = createPostgresPool(connectionString as string);
  const store = new PostgresCoordinatorStore(pool);
  const providerId = randomUUID();

  beforeAll(async () => {
    await pool.query(`INSERT INTO users (id, role) VALUES ($1, 'PROVIDER')`, [providerId]);
  });

  afterAll(async () => {
    await store.close();
  });

  it("persists an authenticated, one-time offer claim", async () => {
    const requesterTokenHash = hashAgentToken(randomBytes(32).toString("base64url"));
    const requester = await store.registerRequester(
      { communityId: "ci-community" },
      requesterTokenHash,
    );
    expect((await store.authenticateRequester(requesterTokenHash))?.id).toBe(requester.id);

    const tokenHash = hashAgentToken(randomBytes(32).toString("base64url"));
    const node = await store.registerProvider(
      {
        ownerId: providerId,
        nodeName: `ci-provider-${randomUUID()}`,
        os: "linux",
        architecture: "x64",
        agentVersion: "0.1.0",
        cpuCores: 4,
        memoryMb: 4096,
        networkModes: ["OFFLINE"],
        isolationLevels: ["GVISOR"],
      },
      tokenHash,
    );
    expect(node).not.toBeNull();
    if (!node) throw new Error("Provider registration failed");
    expect(await store.authenticateProvider(node.id, tokenHash)).toBe(true);
    await store.heartbeatProvider(node.id, {
      availableCpu: 4,
      availableMemoryMb: 4096,
      activeJobs: 0,
      status: "ONLINE",
    });

    const workloadDigest = `sha256:${randomBytes(32).toString("hex")}` as const;
    const job = await store.createPolicyCheckedJob(
      {
        requesterId: requester.id,
        workload: {
          id: randomUUID(),
          name: `ci-workload-${randomUUID()}`,
          version: "1.0.0",
          imageDigest: workloadDigest,
          imageReference: `ghcr.io/powermesh/ci-workload@${workloadDigest}`,
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
        params: {},
        inputDigests: [],
      },
      { tier: "LOW", executableInMvp: true, reasons: [] },
    );

    const signer = createOfferSigner();
    const issuedAt = new Date();
    const offerId = randomUUID();
    const manifest = {
      version: 1 as const,
      offerId,
      jobId: job.id,
      nodeId: node.id,
      workload: job.workload,
      resources: job.resources,
      params: job.params,
      inputDigests: job.inputDigests,
      riskTier: job.riskTier,
      nonce: randomBytes(32).toString("hex"),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 120_000).toISOString(),
    };
    const offer: SignedJobOffer = {
      id: offerId,
      manifest,
      signature: signer.sign(manifest),
      signatureAlgorithm: "Ed25519",
      keyId: signer.keyId,
      approvedAt: null,
      claimedAt: null,
      leaseUntil: null,
    };

    expect((await store.createOffer(offer)).ok).toBe(true);
    expect(await store.listPendingOffers(node.id, issuedAt.toISOString())).toHaveLength(1);
    expect((await store.approveOffer(offer.id, node.id, issuedAt.toISOString())).ok).toBe(true);

    const claim = await store.claimOffer(
      offer.id,
      node.id,
      manifest.nonce,
      issuedAt.toISOString(),
      new Date(issuedAt.getTime() + 60_000).toISOString(),
    );
    expect(claim.ok).toBe(true);

    const replay = await store.claimOffer(
      offer.id,
      node.id,
      manifest.nonce,
      issuedAt.toISOString(),
      new Date(issuedAt.getTime() + 60_000).toISOString(),
    );
    expect(replay).toEqual({ ok: false, reason: "NONCE_ALREADY_USED" });
    expect((await store.findJob(job.id))?.state).toBe("CLAIMED");

    const page = await store.listRequesterJobs(requester.id, 10);
    expect(page.items.map((item) => item.id)).toContain(job.id);
    const events = await store.listJobEvents(job.id, 0);
    expect(events.map((event) => event.toState)).toEqual([
      "SUBMITTED",
      "POLICY_CHECKED",
      "OFFERED",
      "APPROVED",
      "CLAIMED",
    ]);

    const cancellation = await store.cancelRequesterJob(job.id, requester.id, randomUUID());
    expect(cancellation).toMatchObject({ ok: true, status: "CANCEL_REQUESTED" });
    expect(await store.listAgentCommands(node.id)).toEqual([
      { type: "CANCEL", jobId: job.id, reason: "REQUESTER_CANCEL" },
    ]);
  });
});
