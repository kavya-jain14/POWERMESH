import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { createOfferSigner, verifyOfferSignature } from "./offers/signing";

const enrollmentKey = "enrollment-test-key";

async function enrollRequester(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/requesters/register",
    headers: { "x-powermesh-enrollment-key": enrollmentKey },
    payload: { communityId: "test-community" },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { requester: { id: string }; requesterToken: string };
}

describe("coordinator API", () => {
  it("reports health", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "powermesh-api",
      storage: "memory",
    });
    expect(response.json().offerSigningKeyId).toHaveLength(24);
    await app.close();
  });

  it("blocks a workload asking for the Docker socket", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/risk/classify",
      payload: {
        cpu: 1,
        memoryMb: 256,
        timeoutSeconds: 60,
        networkMode: "OFFLINE",
        needsHostMount: false,
        privileged: false,
        dockerSocket: true,
        deviceAccess: false,
        arbitraryImage: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tier).toBe("BLOCKED");
    await app.close();
  });

  it("submits a bounded job after policy classification", async () => {
    const app = buildApp({ enrollmentKey });
    const { requesterToken } = await enrollRequester(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: {
        workload: {
          name: "image-resize",
          version: "1.0.0",
          imageDigest: `sha256:${"a".repeat(64)}`,
        },
        resources: {
          cpu: 1,
          memoryMb: 256,
          timeoutSeconds: 60,
          networkMode: "OFFLINE",
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().job.state).toBe("POLICY_CHECKED");
    expect(response.json().risk.tier).toBe("LOW");
    await app.close();
  });

  it("keeps open-web jobs outside the MVP", async () => {
    const app = buildApp({ enrollmentKey });
    const { requesterToken } = await enrollRequester(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: {
        workload: {
          name: "web-crawler",
          version: "1.0.0",
          imageDigest: `sha256:${"b".repeat(64)}`,
        },
        resources: {
          cpu: 1,
          memoryMb: 256,
          timeoutSeconds: 60,
          networkMode: "OPEN_WEB",
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().risk.tier).toBe("HIGH");
    await app.close();
  });

  it("registers a provider and accepts its heartbeat", async () => {
    const app = buildApp({ enrollmentKey });
    const registration = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      headers: { "x-powermesh-enrollment-key": enrollmentKey },
      payload: {
        ownerId: "22222222-2222-4222-8222-222222222222",
        nodeName: "kavya-mac",
        os: "darwin",
        architecture: "arm64",
        agentVersion: "0.1.0",
        cpuCores: 10,
        memoryMb: 16384,
        networkModes: ["OFFLINE", "RESTRICTED"],
        isolationLevels: ["CONTAINER_BASELINE"],
      },
    });

    expect(registration.statusCode).toBe(201);
    const nodeId = registration.json().node.id;
    const agentToken = registration.json().agentToken;
    const heartbeat = await app.inject({
      method: "POST",
      url: `/v1/nodes/${nodeId}/heartbeat`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: {
        availableCpu: 8,
        availableMemoryMb: 12000,
        activeJobs: 1,
        status: "ONLINE",
      },
    });

    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().node.status).toBe("ONLINE");
    expect(heartbeat.json().node.lastHeartbeatAt).toBeTruthy();
    await app.close();
  });

  it("signs, approves, and claims an offer exactly once", async () => {
    const signer = createOfferSigner();
    const app = buildApp({
      offerSigner: signer,
      coordinatorKey: "coordinator-test-key",
      enrollmentKey,
    });
    const { requesterToken } = await enrollRequester(app);
    const registration = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      headers: { "x-powermesh-enrollment-key": enrollmentKey },
      payload: {
        ownerId: "22222222-2222-4222-8222-222222222222",
        nodeName: "secure-provider",
        os: "linux",
        architecture: "x64",
        agentVersion: "0.1.0",
        cpuCores: 8,
        memoryMb: 8192,
        networkModes: ["OFFLINE", "RESTRICTED"],
        isolationLevels: ["GVISOR"],
      },
    });
    const { node, agentToken } = registration.json();
    await app.inject({
      method: "POST",
      url: `/v1/nodes/${node.id}/heartbeat`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: {
        availableCpu: 6,
        availableMemoryMb: 6144,
        activeJobs: 0,
        status: "ONLINE",
      },
    });

    const submission = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: {
        workload: {
          name: "thumbnail-render",
          version: "1.0.0",
          imageDigest: `sha256:${"c".repeat(64)}`,
        },
        resources: {
          cpu: 2,
          memoryMb: 1024,
          timeoutSeconds: 120,
          networkMode: "OFFLINE",
        },
      },
    });
    const jobId = submission.json().job.id;
    const creation = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/offers`,
      headers: { "x-powermesh-coordinator-key": "coordinator-test-key" },
      payload: { nodeId: node.id, ttlSeconds: 120 },
    });

    expect(creation.statusCode).toBe(201);
    const offer = creation.json().offer;
    expect(verifyOfferSignature(offer, signer.publicKeyPem)).toBe(true);

    const unauthenticatedPoll = await app.inject({
      method: "GET",
      url: `/v1/nodes/${node.id}/offers`,
    });
    expect(unauthenticatedPoll.statusCode).toBe(401);

    const poll = await app.inject({
      method: "GET",
      url: `/v1/nodes/${node.id}/offers`,
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(poll.json().offers).toHaveLength(1);

    const approval = await app.inject({
      method: "POST",
      url: `/v1/nodes/${node.id}/offers/${offer.id}/approve`,
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json().offer.approvedAt).toBeTruthy();

    const claim = await app.inject({
      method: "POST",
      url: `/v1/nodes/${node.id}/offers/${offer.id}/claim`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { nonce: offer.manifest.nonce, leaseSeconds: 60 },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().offer.leaseUntil).toBeTruthy();

    const replay = await app.inject({
      method: "POST",
      url: `/v1/nodes/${node.id}/offers/${offer.id}/claim`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { nonce: offer.manifest.nonce, leaseSeconds: 60 },
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toBe("NONCE_ALREADY_USED");

    const job = await app.inject({
      method: "GET",
      url: `/v1/jobs/${jobId}`,
      headers: { authorization: `Bearer ${requesterToken}` },
    });
    expect(job.json().state).toBe("CLAIMED");
    await app.close();
  });

  it("rejects an offer when the provider lacks the requested capability", async () => {
    const app = buildApp({ coordinatorKey: "coordinator-test-key", enrollmentKey });
    const { requesterToken } = await enrollRequester(app);
    const registration = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      headers: { "x-powermesh-enrollment-key": enrollmentKey },
      payload: {
        ownerId: "22222222-2222-4222-8222-222222222222",
        nodeName: "offline-only",
        os: "linux",
        architecture: "x64",
        agentVersion: "0.1.0",
        cpuCores: 2,
        memoryMb: 1024,
        networkModes: ["OFFLINE"],
        isolationLevels: ["CONTAINER_BASELINE"],
      },
    });
    const { node, agentToken } = registration.json();
    await app.inject({
      method: "POST",
      url: `/v1/nodes/${node.id}/heartbeat`,
      headers: { authorization: `Bearer ${agentToken}` },
      payload: {
        availableCpu: 1,
        availableMemoryMb: 512,
        activeJobs: 0,
        status: "ONLINE",
      },
    });
    const submission = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: {
        workload: {
          name: "large-render",
          version: "1.0.0",
          imageDigest: `sha256:${"d".repeat(64)}`,
        },
        resources: {
          cpu: 2,
          memoryMb: 2048,
          timeoutSeconds: 120,
          networkMode: "OFFLINE",
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/jobs/${submission.json().job.id}/offers`,
      headers: { "x-powermesh-coordinator-key": "coordinator-test-key" },
      payload: { nodeId: node.id },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("NODE_UNAVAILABLE");
    await app.close();
  });

  it("rejects unauthenticated job access and provider enrollment", async () => {
    const app = buildApp({ enrollmentKey });
    const job = await app.inject({ method: "POST", url: "/v1/jobs", payload: {} });
    const provider = await app.inject({
      method: "POST",
      url: "/v1/nodes/register",
      payload: {
        ownerId: "22222222-2222-4222-8222-222222222222",
        nodeName: "untrusted-node",
        os: "linux",
        architecture: "x64",
        agentVersion: "0.1.0",
        cpuCores: 2,
        memoryMb: 1024,
        networkModes: ["OFFLINE"],
        isolationLevels: ["CONTAINER_BASELINE"],
      },
    });

    expect(job.statusCode).toBe(401);
    expect(provider.statusCode).toBe(401);
    await app.close();
  });

  it("prevents one requester from reading another requester's job", async () => {
    const app = buildApp({ enrollmentKey });
    const owner = await enrollRequester(app);
    const stranger = await enrollRequester(app);
    const submission = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${owner.requesterToken}` },
      payload: {
        workload: {
          name: "private-job",
          version: "1.0.0",
          imageDigest: `sha256:${"e".repeat(64)}`,
        },
        resources: {
          cpu: 1,
          memoryMb: 256,
          timeoutSeconds: 60,
          networkMode: "OFFLINE",
        },
      },
    });
    const jobId = submission.json().job.id;

    const denied = await app.inject({
      method: "GET",
      url: `/v1/jobs/${jobId}`,
      headers: { authorization: `Bearer ${stranger.requesterToken}` },
    });
    const allowed = await app.inject({
      method: "GET",
      url: `/v1/jobs/${jobId}`,
      headers: { authorization: `Bearer ${owner.requesterToken}` },
    });

    expect(denied.statusCode).toBe(404);
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("rate limits repeated requests", async () => {
    const app = buildApp({ rateLimitMax: 2 });
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });
    const limited = await app.inject({ method: "GET", url: "/health" });

    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("RATE_LIMITED");
    await app.close();
  });
});
