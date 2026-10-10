import { describe, expect, it } from "vitest";
import { buildDockerArgs } from "./docker";
import type { SandboxJob } from "./types";

const digest = "a".repeat(64);
const baseJob: SandboxJob = {
  jobId: "job-123",
  image: `ghcr.io/powermesh/worker@sha256:${digest}`,
  isolation: "GVISOR",
  networkMode: "OFFLINE",
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
});
