import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runAgentDoctor } from "./doctor";
import type { RuntimeCapability } from "./sandbox/runtime-probe";

const publicKey = generateKeyPairSync("ed25519")
  .publicKey.export({
    type: "spki",
    format: "pem",
  })
  .toString();

const readyRuntime: RuntimeCapability = {
  dockerAvailable: true,
  rootless: false,
  canExecute: true,
  executionMode: "WSL2_DOCKER_DESKTOP",
  accelerators: [
    {
      kind: "NVIDIA_CUDA",
      index: 0,
      name: "NVIDIA GeForce RTX 4060 Laptop GPU",
      memoryMb: 8192,
    },
  ],
  isolationLevels: ["CONTAINER_BASELINE"],
  reasons: ["WSL2 Docker Desktop demo mode is enabled; this is not rootless isolation"],
};

function successfulFetcher(input: string) {
  const body = input.endsWith("/health")
    ? { status: "ok", service: "powermesh-api" }
    : { algorithm: "Ed25519", publicKey };
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("Agent connectivity doctor", () => {
  it("marks the complete HTTPS, Docker, and GPU path ready", async () => {
    const gpuContainerProbe = vi.fn().mockResolvedValue("NVIDIA GeForce RTX 4060 Laptop GPU");
    const report = await runAgentDoctor({
      coordinatorUrl: "https://coordinator.example",
      requireGpu: true,
      fetcher: successfulFetcher,
      runtimeProbe: async () => readyRuntime,
      gpuContainerProbe,
    });

    expect(report.ready).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual([
      "coordinator-url",
      "coordinator-health",
      "signing-key",
      "docker",
      "execution-mode",
      "gpu-host",
      "gpu-container",
    ]);
    expect(gpuContainerProbe).toHaveBeenCalledWith("nvidia/cuda:12.8.1-base-ubuntu24.04");
  });

  it("blocks an insecure remote coordinator before making requests", async () => {
    const fetcher = vi.fn();
    const report = await runAgentDoctor({
      coordinatorUrl: "http://192.168.1.20:4000",
      fetcher,
      runtimeProbe: async () => readyRuntime,
    });

    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.id === "coordinator-url")).toMatchObject({
      ok: false,
      detail: "COORDINATOR_TLS_REQUIRED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not mistake a localhost-prefixed hostname for loopback", async () => {
    const fetcher = vi.fn();
    const report = await runAgentDoctor({
      coordinatorUrl: "http://localhost.attacker.example:4000",
      fetcher,
      runtimeProbe: async () => readyRuntime,
    });

    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.id === "coordinator-url")?.detail).toBe(
      "COORDINATOR_TLS_REQUIRED",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("blocks GPU scheduling when Docker cannot use the detected GPU", async () => {
    const report = await runAgentDoctor({
      coordinatorUrl: "https://coordinator.example",
      requireGpu: true,
      fetcher: successfulFetcher,
      runtimeProbe: async () => readyRuntime,
      gpuContainerProbe: async () => {
        throw new Error("could not select device driver with capabilities: [[gpu]]");
      },
    });

    expect(report.ready).toBe(false);
    expect(report.checks.find((check) => check.id === "gpu-container")).toMatchObject({
      ok: false,
      detail: "could not select device driver with capabilities: [[gpu]]",
    });
  });
});
