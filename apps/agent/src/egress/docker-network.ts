import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const PINNED_IMAGE = /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64})$/;

export interface RestrictedNetwork {
  networkName: string;
  workloadIp: string;
  proxyIp: string;
}

type DockerCommand = (args: string[]) => Promise<void>;

export class EgressNetworkController {
  constructor(
    private readonly proxyImage: string,
    private readonly docker: DockerCommand = async (args) => {
      await execFile("docker", args, { timeout: 30_000 });
    },
  ) {
    if (!PINNED_IMAGE.test(proxyImage)) throw new Error("Egress proxy image must be digest-pinned");
  }

  private names(jobId: string) {
    const digest = createHash("sha256").update(jobId).digest();
    const suffix = digest.toString("hex").slice(0, 12);
    const subnet = `10.${64 + ((digest[0] ?? 0) % 64)}.${digest[1] ?? 0}.0/24`;
    const prefix = subnet.slice(0, subnet.lastIndexOf("."));
    return {
      internal: `powermesh-job-${suffix}`,
      uplink: `powermesh-uplink-${suffix}`,
      proxy: `powermesh-egress-${suffix}`,
      subnet,
      proxyIp: `${prefix}.2`,
      workloadIp: `${prefix}.3`,
    };
  }

  async prepare(
    jobId: string,
    allowedHosts: string[],
    quotas: { maxRequests: number; maxBytes: number; timeoutMs: number },
  ): Promise<RestrictedNetwork> {
    if (
      !Number.isInteger(quotas.maxRequests) ||
      quotas.maxRequests < 1 ||
      !Number.isInteger(quotas.maxBytes) ||
      quotas.maxBytes < 1 ||
      !Number.isInteger(quotas.timeoutMs) ||
      quotas.timeoutMs < 100
    ) {
      throw new Error("Invalid egress quota");
    }
    const names = this.names(jobId);
    try {
      await this.docker([
        "network",
        "create",
        "--internal",
        "--subnet",
        names.subnet,
        names.internal,
      ]);
      await this.docker(["network", "create", names.uplink]);
      await this.docker([
        "run",
        "--detach",
        "--rm",
        "--name",
        names.proxy,
        "--network",
        names.internal,
        "--ip",
        names.proxyIp,
        "--read-only",
        "--user=65532:65532",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges=true",
        "--pids-limit=64",
        "--memory=128m",
        "--memory-swap=128m",
        "--cpus=0.5",
        "--env",
        `POWERMESH_ALLOWED_HOSTS=${JSON.stringify(allowedHosts)}`,
        "--env",
        `POWERMESH_EGRESS_MAX_REQUESTS=${quotas.maxRequests}`,
        "--env",
        `POWERMESH_EGRESS_MAX_BYTES=${quotas.maxBytes}`,
        "--env",
        `POWERMESH_EGRESS_TIMEOUT_MS=${quotas.timeoutMs}`,
        this.proxyImage,
      ]);
      await this.docker(["network", "connect", names.uplink, names.proxy]);
      return { networkName: names.internal, proxyIp: names.proxyIp, workloadIp: names.workloadIp };
    } catch (error) {
      await this.cleanup(jobId);
      throw error;
    }
  }

  async cleanup(jobId: string): Promise<void> {
    const names = this.names(jobId);
    await Promise.allSettled([this.docker(["kill", names.proxy])]);
    await Promise.allSettled([
      this.docker(["network", "rm", names.internal]),
      this.docker(["network", "rm", names.uplink]),
    ]);
  }
}
