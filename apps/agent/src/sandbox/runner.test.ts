import { describe, expect, it, vi } from "vitest";
import type { EgressNetworkController } from "../egress/docker-network";
import type { SandboxExecutor } from "./docker";
import { executeSandboxJob } from "./runner";
import type { SandboxJob, SandboxResult } from "./types";

const job: SandboxJob = {
  jobId: "job-1",
  image: `sha256:${"a".repeat(64)}`,
  isolation: "GVISOR",
  networkMode: "RESTRICTED",
  allowedHosts: ["api.example.com"],
  limits: {
    cpu: 1,
    memoryMb: 256,
    pids: 128,
    timeoutSeconds: 30,
    tmpfsMb: 64,
    maxOutputBytes: 1024,
  },
};

describe("sandbox runner", () => {
  it.each(["OFFLINE", "RESTRICTED"] as const)(
    "does not start setup or execution for an already cancelled %s job",
    async (networkMode) => {
      const controller = new AbortController();
      controller.abort();
      const execute = vi.fn();
      const prepare = vi.fn();
      const cleanup = vi.fn();

      await expect(
        executeSandboxJob(
          { ...job, networkMode },
          { execute, kill: vi.fn() },
          { prepare, cleanup } as unknown as EgressNetworkController,
          controller.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(prepare).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
    },
  );

  it("cleans up without starting a workload when cancelled during network preparation", async () => {
    const controller = new AbortController();
    const execute = vi.fn();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    let finishPreparation!: (network: {
      networkName: string;
      proxyIp: string;
      workloadIp: string;
    }) => void;
    const prepare = vi.fn(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        }),
    );
    const execution = executeSandboxJob(
      job,
      { execute, kill: vi.fn() },
      { prepare, cleanup } as unknown as EgressNetworkController,
      controller.signal,
    );
    expect(prepare).toHaveBeenCalledOnce();
    controller.abort();
    finishPreparation({
      networkName: "powermesh-job-1",
      proxyIp: "10.64.1.2",
      workloadIp: "10.64.1.3",
    });

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    expect(execute).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledExactlyOnceWith("job-1");
  });

  it("always removes the per-job network after restricted execution", async () => {
    const result: SandboxResult = {
      exitCode: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      timedOut: false,
      outputTruncated: false,
    };
    const execute = vi.fn().mockResolvedValue(result);
    const prepare = vi.fn().mockResolvedValue({
      networkName: "powermesh-job-1",
      proxyIp: "10.64.1.2",
      workloadIp: "10.64.1.3",
    });
    const cleanup = vi.fn().mockResolvedValue(undefined);
    await expect(
      executeSandboxJob(
        job,
        { execute } as unknown as SandboxExecutor,
        { prepare, cleanup } as unknown as EgressNetworkController,
      ),
    ).resolves.toEqual(result);
    expect(execute.mock.calls[0]?.[0].restrictedNetwork).toBeDefined();
    expect(cleanup).toHaveBeenCalledWith("job-1");
  });

  it("cleans up even when execution fails", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    await expect(
      executeSandboxJob(
        job,
        { execute: vi.fn().mockRejectedValue(new Error("failed")) } as unknown as SandboxExecutor,
        {
          prepare: vi.fn().mockResolvedValue({
            networkName: "network",
            proxyIp: "10.64.1.2",
            workloadIp: "10.64.1.3",
          }),
          cleanup,
        } as unknown as EgressNetworkController,
      ),
    ).rejects.toThrow("failed");
    expect(cleanup).toHaveBeenCalledWith("job-1");
  });
});
