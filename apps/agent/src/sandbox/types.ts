import type { NetworkMode } from "@powermesh/contracts";

export type SandboxIsolation = "CONTAINER_BASELINE" | "GVISOR";

export interface SandboxLimits {
  cpu: number;
  memoryMb: number;
  pids: number;
  timeoutSeconds: number;
  tmpfsMb: number;
  maxOutputBytes: number;
}

export interface SandboxJob {
  jobId: string;
  image: string;
  command?: string[];
  isolation: SandboxIsolation;
  networkMode: NetworkMode;
  allowedHosts: string[];
  restrictedNetwork?: {
    networkName: string;
    workloadIp: string;
    proxyIp: string;
  };
  limits: SandboxLimits;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  outputTruncated: boolean;
}
