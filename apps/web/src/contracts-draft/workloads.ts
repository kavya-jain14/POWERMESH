/**
 * ⚠️ DRAFT — workload catalogue fixture. The real signed definition lives in
 * `workloads/image-transform` (Kavya). Digests below are placeholders, not real images.
 */
import type { WorkloadDefinition } from "./types";

const MB = 1024 * 1024;

export const IMAGE_TRANSFORM: WorkloadDefinition = {
  id: "image-transform",
  name: "Image transform",
  version: "1.0.0",
  summary: "Resize, convert and compress a batch of images. Fixed parameters, no network.",
  publisher: "PowerMesh",
  imageDigest: "sha256:7c3f9a1be04d52c8e6a1f0b39d24c7e85a6b1d0f93e2c4a7b8d5e6f1a2c3b4d9",
  signatureVerified: true,
  runsRequesterCode: false,
  needsSecrets: false,
  needsDeviceAccess: false,
  inputSchema: { accept: ["image/png", "image/jpeg", "image/webp"], maxFiles: 12, maxFileBytes: 10 * MB, maxTotalBytes: 50 * MB },
  outputSchema: { contentTypes: ["image/webp", "image/jpeg", "image/png"], maxFileBytes: 10 * MB },
  params: [
    {
      key: "format",
      label: "Output format",
      type: "enum",
      options: [
        { value: "webp", label: "WebP" },
        { value: "jpeg", label: "JPEG" },
        { value: "png", label: "PNG" },
      ],
      default: "webp",
    },
    { key: "maxWidth", label: "Maximum width", type: "int", min: 256, max: 4096, step: 64, default: 1600, unit: "px", hint: "Images narrower than this keep their size." },
    { key: "quality", label: "Quality", type: "int", min: 40, max: 95, default: 82, unit: "%", hint: "Ignored for PNG." },
  ],
  allowedNetworkModes: ["OFFLINE"],
  minIsolation: "docker-rootless",
  limits: { cpuCores: 1, memoryBytes: 512 * MB, diskBytes: 1024 * MB, wallClockSeconds: 300, pids: 64 },
  idempotent: true,
  availability: { status: "available" },
};

export const REPO_METADATA: WorkloadDefinition = {
  id: "repo-metadata",
  name: "Public repository metadata",
  version: "0.1.0",
  summary: "Fetch stars, licence and release info for public repositories through the egress gateway.",
  publisher: "PowerMesh",
  imageDigest: "sha256:1a9e44c07b3d2f6e8a5c9b1d0e7f3a2c4b6d8e0f1a3c5b7d9e2f4a6c8b0d1e3f",
  signatureVerified: true,
  runsRequesterCode: false,
  needsSecrets: false,
  needsDeviceAccess: false,
  inputSchema: { accept: ["text/plain"], maxFiles: 1, maxFileBytes: 64 * 1024, maxTotalBytes: 64 * 1024 },
  outputSchema: { contentTypes: ["application/json"], maxFileBytes: MB },
  params: [],
  allowedNetworkModes: ["RESTRICTED"],
  minIsolation: "gvisor",
  limits: { cpuCores: 1, memoryBytes: 256 * MB, diskBytes: 128 * MB, wallClockSeconds: 120, pids: 32 },
  idempotent: true,
  availability: {
    status: "unavailable",
    reason: "Coming later — needs the controlled egress gateway. The offline demo ships first.",
  },
};

export const CUSTOM_CONTAINER: WorkloadDefinition = {
  id: "custom-container",
  name: "Custom container image",
  version: "—",
  summary: "Run your own image or script.",
  publisher: "Requester",
  imageDigest: "unpinned",
  signatureVerified: false,
  runsRequesterCode: true,
  needsSecrets: false,
  needsDeviceAccess: false,
  inputSchema: { accept: [], maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0 },
  outputSchema: { contentTypes: [], maxFileBytes: 0 },
  params: [],
  allowedNetworkModes: ["OFFLINE"],
  minIsolation: "microvm",
  limits: { cpuCores: 2, memoryBytes: 2048 * MB, diskBytes: 4096 * MB, wallClockSeconds: 900, pids: 256 },
  idempotent: false,
  availability: {
    status: "unavailable",
    reason: "Not on personal devices — your own code is HIGH risk and needs a dedicated verified node.",
  },
};

export const WORKLOADS: readonly WorkloadDefinition[] = [IMAGE_TRANSFORM, REPO_METADATA, CUSTOM_CONTAINER];

export function getWorkload(id: string): WorkloadDefinition | undefined {
  return WORKLOADS.find((w) => w.id === id);
}
