import { describe, expect, it } from "vitest";
import { buildDockerArgs } from "./docker";
import type { SandboxJob } from "./types";

const digest = "a".repeat(64);
const baseJob: SandboxJob = {
  jobId: "job-123",
  image: `ghcr.io/powermesh/worker@sha256:${digest}`,
  isolation: "GVISOR",
  networkMode: "OFFLINE",
  allowedHosts: [],
  limits: {
    cpu: 2,
    memoryMb: 512,
    pids: 64,
    timeoutSeconds: 30,
    tmpfsMb: 64,
    maxOutputBytes: 1_024,
  },
};

describe("Docker sandbox command", () => {
  it("enforces gVisor, identity, offline networking, and hard limits", () => {
    const args = buildDockerArgs(baseJob, "powermesh-job-123");
    expect(args).toContain("--runtime=runsc");
    expect(args).toContain("--network=none");
    expect(args).toContain("--read-only");
    expect(args).toContain("--user=65532:65532");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--security-opt=no-new-privileges=true");
    expect(args).toContain("--pids-limit=64");
    expect(args).toContain("--memory=512m");
    expect(args).toContain("--memory-swap=512m");
    expect(args).toContain("--cpus=2");
    expect(args.some((arg) => arg.startsWith("--tmpfs=/tmp:"))).toBe(true);
    expect(args.some((arg) => arg.startsWith("--volume"))).toBe(false);
    expect(args).not.toContain("--privileged");
  });

  it("passes commands as discrete arguments without a host shell", () => {
    const command = ["sh", "-c", "echo safe; touch /host/pwned"];
    const args = buildDockerArgs({ ...baseJob, command }, "powermesh-safe");
    expect(args.slice(-command.length)).toEqual(command);
  });

  it("rejects unpinned images and networked execution", () => {
    expect(() => buildDockerArgs({ ...baseJob, image: "ubuntu:latest" }, "powermesh-test")).toThrow(
      /pinned/,
    );
    expect(() =>
      buildDockerArgs({ ...baseJob, networkMode: "RESTRICTED" }, "powermesh-test"),
    ).toThrow(/controlled egress/);
  });

  it("routes restricted traffic only through the fixed proxy on an internal network", () => {
    const args = buildDockerArgs(
      {
        ...baseJob,
        networkMode: "RESTRICTED",
        allowedHosts: ["api.example.com"],
        restrictedNetwork: {
          networkName: "powermesh-job-abc",
          workloadIp: "10.64.1.3",
          proxyIp: "10.64.1.2",
        },
      },
      "powermesh-restricted",
    );
    expect(args).toContain("--network=powermesh-job-abc");
    expect(args).toContain("--ip=10.64.1.3");
    expect(args).toContain("--dns=127.0.0.1");
    expect(args).toContain("HTTP_PROXY=http://10.64.1.2:8080");
    expect(args).not.toContain("--network=bridge");
  });

  it("passes only the selected NVIDIA device to a CUDA workload", () => {
    const args = buildDockerArgs(
      {
        ...baseJob,
        isolation: "CONTAINER_BASELINE",
        accelerator: { kind: "NVIDIA_CUDA", deviceIds: ["0"] },
      },
      "powermesh-gpu",
    );
    expect(args).toContain("--gpus");
    expect(args).toContain("device=0");
    expect(args).not.toContain("--runtime=runsc");
  });
});
