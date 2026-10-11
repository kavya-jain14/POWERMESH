import { describe, expect, it } from "vitest";
import { selectProvider } from "./matcher";
import type { JobRecord, ProviderNodeRecord } from "./store";

const now = new Date("2026-10-10T18:00:00.000Z");
const job: JobRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  requesterId: "22222222-2222-4222-8222-222222222222",
  workload: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "image-transform",
    version: "1.0.0",
    imageDigest: `sha256:${"a".repeat(64)}`,
    imageReference: `ghcr.io/powermesh/image-transform@sha256:${"a".repeat(64)}`,
  },
  resources: {
    cpu: 1,
    memoryMb: 512,
    timeoutSeconds: 300,
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
  state: "POLICY_CHECKED",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

function provider(id: string, overrides: Partial<ProviderNodeRecord> = {}): ProviderNodeRecord {
  return {
    id,
    ownerId: "44444444-4444-4444-8444-444444444444",
    nodeName: id,
    os: "linux",
    architecture: "x64",
    agentVersion: "0.1.0",
    cpuCores: 8,
    memoryMb: 8192,
    networkModes: ["OFFLINE"],
    isolationLevels: ["CONTAINER_BASELINE"],
    availableCpu: 8,
    availableMemoryMb: 8192,
    availableGpuCount: 0,
    activeJobs: 0,
    status: "ONLINE",
    lastHeartbeatAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("coordinator matcher", () => {
  it("chooses the least-loaded fresh compatible provider deterministically", () => {
    const selected = selectProvider(
      job,
      [
        provider("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { activeJobs: 1 }),
        provider("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      ],
      now,
    );
    expect(selected?.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("rejects stale and capability-incompatible providers", () => {
    const selected = selectProvider(
      job,
      [
        provider("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
          lastHeartbeatAt: new Date(now.getTime() - 16_000).toISOString(),
        }),
        provider("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { networkModes: ["RESTRICTED"] }),
      ],
      now,
    );
    expect(selected).toBeNull();
  });

  it("matches CUDA jobs only to providers with available NVIDIA capacity", () => {
    const gpuJob: JobRecord = {
      ...job,
      resources: { ...job.resources, accelerator: "NVIDIA_CUDA", gpuCount: 1 },
    };
    const selected = selectProvider(
      gpuJob,
      [
        provider("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        provider("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
          accelerators: [
            { kind: "NVIDIA_CUDA", index: 0, name: "NVIDIA RTX Demo", memoryMb: 8192 },
          ],
          availableGpuCount: 1,
        }),
      ],
      now,
    );
    expect(selected?.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});
