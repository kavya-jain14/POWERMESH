import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { canonicalizeOfferManifest, type SignedJobOffer } from "@powermesh/contracts";
import { describe, expect, it, vi } from "vitest";
import { AgentJobLoop } from "./job-loop";
import { coordinatorKeyId } from "./offer-verification";

const nodeId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const offerId = "33333333-3333-4333-8333-333333333333";

function signedOffer(
  workloadName = "image-transform",
  params: Record<string, string | number | boolean> = {
    format: "webp",
    maxWidth: 1600,
    quality: 82,
  },
): { offer: SignedJobOffer; publicKey: string; privateKey: KeyObject } {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifest = {
    version: 1 as const,
    offerId,
    jobId,
    nodeId,
    workload: {
      id: "44444444-4444-4444-8444-444444444444",
      name: workloadName,
      version: "1.0.0",
      imageDigest: `sha256:${"a".repeat(64)}`,
      imageReference: `ghcr.io/powermesh/image-transform@sha256:${"a".repeat(64)}`,
    },
    resources: {
      cpu: 1,
      memoryMb: 512,
      timeoutSeconds: 60,
      maxOutputBytes: 1024,
      networkMode: "OFFLINE" as const,
      allowedHosts: [],
      needsHostMount: false,
      privileged: false,
      dockerSocket: false,
      deviceAccess: false,
      arbitraryImage: false,
      ...(workloadName === "gpu-benchmark"
        ? { accelerator: "NVIDIA_CUDA" as const, gpuCount: 1 }
        : {}),
    },
    params,
    inputDigests: [],
    riskTier: "LOW" as const,
    nonce: "b".repeat(64),
    issuedAt: "2026-10-10T08:00:00.000Z",
    expiresAt: "2026-10-10T08:02:00.000Z",
  };
  return {
    publicKey,
    privateKey: keys.privateKey,
    offer: {
      id: offerId,
      manifest,
      signature: sign(
        null,
        Buffer.from(canonicalizeOfferManifest(manifest)),
        keys.privateKey,
      ).toString("base64url"),
      signatureAlgorithm: "Ed25519",
      keyId: coordinatorKeyId(publicKey),
      approvedAt: null,
      claimedAt: null,
      leaseUntil: null,
    },
  };
}

describe("Agent job loop", () => {
  it.each(["heartbeat", "offers", "prompt", "approve", "claim", "start"])(
    "does not start execution or process another offer after Stop during %s",
    async (stage) => {
      const { offer, publicKey } = signedOffer();
      let release!: () => void;
      let reached!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const pause = async () => {
        reached();
        await paused;
      };
      const fetcher = vi.fn(async (input: string) => {
        const path = new URL(input).pathname;
        if (path.endsWith(`/${stage}`)) await pause();
        if (path.endsWith("/heartbeat")) return Response.json({ node: { id: nodeId } });
        if (path.endsWith("/offers")) return Response.json({ offers: [offer, offer] });
        if (path.endsWith("/approve") || path.endsWith("/claim")) return Response.json({ offer });
        return Response.json({ job: { id: jobId } });
      });
      const executor = {
        execute: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP"),
          stderr: Buffer.alloc(0),
          timedOut: false,
          outputTruncated: false,
        }),
        kill: vi.fn(),
      };
      const approveOffer = vi.fn(async () => {
        if (stage === "prompt") await pause();
        return true;
      });
      const loop = new AgentJobLoop({
        origin: "https://coordinator.example",
        nodeId,
        agentToken: "agent-token",
        coordinatorPublicKey: publicKey,
        runtime: {
          dockerAvailable: true,
          rootless: true,
          canExecute: true,
          executionMode: "ROOTLESS_LINUX",
          accelerators: [],
          isolationLevels: ["CONTAINER_BASELINE"],
          reasons: [],
        },
        executor,
        approveOffer,
        fetcher,
        heartbeat: () => ({
          availableCpu: 4,
          availableMemoryMb: 4096,
          activeJobs: 0,
          status: "ONLINE",
        }),
      });
      const execution = loop.runOnce();
      await entered;
      loop.stop();
      const requestCountAtStop = fetcher.mock.calls.length;
      release();
      await execution;

      expect(executor.execute).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(requestCountAtStop);
      expect(approveOffer.mock.calls.length).toBeLessThanOrEqual(1);
      expect(loop.activeJobCount()).toBe(0);
    },
  );

  it("does not contact the coordinator when a stopped loop is run again", async () => {
    const { publicKey } = signedOffer();
    const fetcher = vi.fn();
    const loop = new AgentJobLoop({
      origin: "https://coordinator.example",
      nodeId,
      agentToken: "agent-token",
      coordinatorPublicKey: publicKey,
      runtime: {
        dockerAvailable: true,
        rootless: true,
        canExecute: true,
        executionMode: "ROOTLESS_LINUX",
        accelerators: [],
        isolationLevels: ["CONTAINER_BASELINE"],
        reasons: [],
      },
      executor: { execute: vi.fn(), kill: vi.fn() },
      fetcher,
      approveOffer: async () => true,
      heartbeat: () => ({
        availableCpu: 4,
        availableMemoryMb: 4096,
        activeJobs: 0,
        status: "ONLINE",
      }),
    });
    loop.stop();
    await expect(loop.runOnce()).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["approve", false],
    ["claim", false],
    ["approve", true],
    ["claim", true],
  ] as const)(
    "rejects a changed %s response before execution even if re-signed: %s",
    async (transition, reSigned) => {
      const { offer, publicKey, privateKey } = signedOffer();
      const changedManifest = {
        ...offer.manifest,
        workload: {
          ...offer.manifest.workload,
          imageReference: `ghcr.io/powermesh/other@sha256:${"c".repeat(64)}`,
          imageDigest: `sha256:${"c".repeat(64)}`,
        },
      };
      const changedOffer = {
        ...offer,
        manifest: changedManifest,
        signature: reSigned
          ? sign(
              null,
              Buffer.from(canonicalizeOfferManifest(changedManifest)),
              privateKey,
            ).toString("base64url")
          : offer.signature,
      };
      const paths: string[] = [];
      const json = (value: unknown) => Response.json(value);
      const fetcher = vi.fn(async (input: string) => {
        const path = new URL(input).pathname;
        paths.push(path);
        if (path.endsWith("/heartbeat")) return json({ node: { id: nodeId } });
        if (path.endsWith("/offers")) return json({ offers: [offer] });
        if (path.endsWith(`/${transition}`)) return json({ offer: changedOffer });
        if (path.endsWith("/approve") || path.endsWith("/claim")) return json({ offer });
        return json({ job: { id: jobId, state: "RUNNING" } });
      });
      const executor = {
        execute: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP"),
          stderr: Buffer.alloc(0),
          timedOut: false,
          outputTruncated: false,
        }),
        kill: vi.fn(),
      };
      const loop = new AgentJobLoop({
        origin: "https://coordinator.example",
        nodeId,
        agentToken: "agent-token",
        coordinatorPublicKey: publicKey,
        runtime: {
          dockerAvailable: true,
          rootless: true,
          canExecute: true,
          executionMode: "ROOTLESS_LINUX",
          accelerators: [],
          isolationLevels: ["CONTAINER_BASELINE"],
          reasons: [],
        },
        executor,
        heartbeat: () => ({
          availableCpu: 4,
          availableMemoryMb: 4096,
          activeJobs: 0,
          status: "ONLINE",
        }),
        approveOffer: async () => true,
        fetcher,
      });

      await expect(loop.runOnce()).resolves.toEqual([
        { offerId, status: "REJECTED", reason: "PROCESSING_FAILED" },
      ]);
      expect(executor.execute).not.toHaveBeenCalled();
      expect(paths.some((path) => path.endsWith("/start"))).toBe(false);
      if (transition === "approve") {
        expect(paths.some((path) => path.endsWith("/claim"))).toBe(false);
      }
    },
  );

  it("heartbeats, verifies, approves, claims, executes, and reports without sending raw output", async () => {
    const { offer, publicKey } = signedOffer();
    const requests: Array<{ path: string; body?: unknown }> = [];
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path, body });
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (path.endsWith("/heartbeat")) return json({ node: { id: nodeId } });
      if (path.endsWith("/offers")) return json({ offers: [offer] });
      if (path.endsWith("/approve")) {
        return json({ offer: { ...offer, approvedAt: "2026-10-10T08:00:10.000Z" } });
      }
      if (path.endsWith("/claim")) {
        return json({
          offer: {
            ...offer,
            approvedAt: "2026-10-10T08:00:10.000Z",
            claimedAt: "2026-10-10T08:00:11.000Z",
            leaseUntil: "2026-10-10T08:01:21.000Z",
          },
        });
      }
      if (path.endsWith("/start")) return json({ job: { id: jobId, state: "RUNNING" } });
      if (path.endsWith("/complete")) return json({ job: { id: jobId, state: "SUCCEEDED" } });
      return new Response(null, { status: 404 });
    });
    const executor = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP"),
        stderr: Buffer.alloc(0),
        timedOut: false,
        outputTruncated: false,
      }),
      kill: vi.fn().mockReturnValue(true),
    };
    const loop = new AgentJobLoop({
      origin: "https://coordinator.example",
      nodeId,
      agentToken: "agent-token",
      coordinatorPublicKey: publicKey,
      runtime: {
        dockerAvailable: true,
        rootless: true,
        canExecute: true,
        executionMode: "ROOTLESS_LINUX",
        accelerators: [],
        isolationLevels: ["CONTAINER_BASELINE"],
        reasons: [],
      },
      executor,
      heartbeat: () => ({
        availableCpu: 4,
        availableMemoryMb: 4096,
        activeJobs: 0,
        status: "ONLINE",
      }),
      approveOffer: async () => true,
      fetcher,
    });

    await expect(loop.runOnce()).resolves.toEqual([{ offerId, status: "SUCCEEDED" }]);
    expect(executor.execute).toHaveBeenCalledOnce();
    const completion = requests.find(({ path }) => path.endsWith("/complete"));
    expect(completion?.body).toMatchObject({
      exitCode: 0,
      outputValidated: true,
      stdout: { sizeBytes: 12, digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    });
    expect(JSON.stringify(completion?.body)).not.toContain("WEBP");
  });

  it("validates and reports bounded CUDA benchmark proof", async () => {
    const { offer, publicKey } = signedOffer("gpu-benchmark", {
      matrixSize: 2048,
      iterations: 20,
    });
    const requests: Array<{ path: string; body?: unknown }> = [];
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path, body });
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (path.endsWith("/heartbeat")) return json({ node: { id: nodeId } });
      if (path.endsWith("/offers")) return json({ offers: [offer] });
      if (path.endsWith("/approve")) {
        return json({ offer: { ...offer, approvedAt: "2026-10-10T08:00:10.000Z" } });
      }
      if (path.endsWith("/claim")) {
        return json({
          offer: {
            ...offer,
            approvedAt: "2026-10-10T08:00:10.000Z",
            claimedAt: "2026-10-10T08:00:11.000Z",
            leaseUntil: "2026-10-10T08:01:21.000Z",
          },
        });
      }
      if (path.endsWith("/start")) return json({ job: { id: jobId, state: "RUNNING" } });
      if (path.endsWith("/complete")) return json({ job: { id: jobId, state: "SUCCEEDED" } });
      return new Response(null, { status: 404 });
    });
    const resultSummary = {
      type: "gpu-benchmark",
      gpuName: "NVIDIA GeForce RTX 4060 Laptop GPU",
      cudaRuntime: "12.8",
      computeCapability: "8.9",
      memoryMb: 8188,
      matrixSize: 2048,
      iterations: 20,
      durationMs: 3210.125,
      checksum: "0123456789abcdef",
    } as const;
    const executor = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify(resultSummary)),
        stderr: Buffer.alloc(0),
        timedOut: false,
        outputTruncated: false,
      }),
      kill: vi.fn().mockReturnValue(true),
    };
    const loop = new AgentJobLoop({
      origin: "https://coordinator.example",
      nodeId,
      agentToken: "agent-token",
      coordinatorPublicKey: publicKey,
      runtime: {
        dockerAvailable: true,
        rootless: false,
        canExecute: true,
        executionMode: "WSL2_DOCKER_DESKTOP",
        accelerators: [
          {
            kind: "NVIDIA_CUDA",
            index: 0,
            name: resultSummary.gpuName,
            memoryMb: resultSummary.memoryMb,
          },
        ],
        isolationLevels: ["CONTAINER_BASELINE"],
        reasons: ["demo mode"],
      },
      executor,
      heartbeat: () => ({
        availableCpu: 4,
        availableMemoryMb: 4096,
        availableGpuCount: 1,
        activeJobs: 0,
        status: "ONLINE",
      }),
      approveOffer: async () => true,
      fetcher,
    });

    await expect(loop.runOnce()).resolves.toEqual([{ offerId, status: "SUCCEEDED" }]);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        accelerator: { kind: "NVIDIA_CUDA", deviceIds: ["0"] },
      }),
      expect.anything(),
    );
    const completion = requests.find(({ path }) => path.endsWith("/complete"));
    expect(completion?.body).toMatchObject({ outputValidated: true, resultSummary });
  });
});
