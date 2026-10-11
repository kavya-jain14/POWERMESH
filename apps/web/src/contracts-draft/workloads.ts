/**
 * ⚠️ DRAFT — workload catalogue fixture. The real signed definition lives in
 * `workloads/image-transform` (Kavya). Shapes follow Q28 (main, 2026-10-10 22:24). Digests below are placeholders, not real
 * images, so nothing here may reach real execution.
 */
import type { ParamsSchema, WorkloadDefinition } from "./types";

const MB = 1024 * 1024;
const NO_PARAMS: ParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
};

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
  input: {
    contentTypes: ["image/png", "image/jpeg", "image/webp"],
    maxFiles: 12,
    maxBytesPerFile: 10 * MB,
    maxTotalBytes: 50 * MB,
  },
  output: { contentTypes: ["image/webp", "image/jpeg", "image/png"], maxBytesPerFile: 10 * MB },
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    required: ["format", "maxWidth", "quality"],
    properties: {
      format: {
        type: "string",
        enum: ["webp", "jpeg", "png"],
        default: "webp",
        title: "Output format",
        description: "WebP is smallest for photos and drawings.",
      },
      maxWidth: {
        type: "integer",
        minimum: 256,
        maximum: 4096,
        multipleOf: 64,
        default: 1600,
        title: "Maximum width",
        "x-unit": "px",
        description: "Images narrower than this keep their size.",
      },
      quality: {
        type: "integer",
        minimum: 40,
        maximum: 95,
        default: 82,
        title: "Quality",
        "x-unit": "%",
        description: "Ignored for PNG.",
      },
    },
  },
  allowedNetworkModes: ["OFFLINE"],
  minimumIsolation: "docker-rootless",
  limits: {
    cpuCores: 1,
    memoryBytes: 512 * MB,
    diskBytes: 1024 * MB,
    timeoutSeconds: 300,
    pidLimit: 64,
    maxOutputBytes: 50 * MB,
  },
  idempotent: true,
  availability: { status: "available" },
};

export const REPO_METADATA: WorkloadDefinition = {
  id: "repo-metadata",
  name: "Public repository metadata",
  version: "0.1.0",
  summary:
    "Fetch stars, licence and release info for public repositories through the egress gateway.",
  publisher: "PowerMesh",
  imageDigest: "sha256:1a9e44c07b3d2f6e8a5c9b1d0e7f3a2c4b6d8e0f1a3c5b7d9e2f4a6c8b0d1e3f",
  signatureVerified: true,
  runsRequesterCode: false,
  needsSecrets: false,
  needsDeviceAccess: false,
  input: {
    contentTypes: ["text/plain"],
    maxFiles: 1,
    maxBytesPerFile: 64 * 1024,
    maxTotalBytes: 64 * 1024,
  },
  output: { contentTypes: ["application/json"], maxBytesPerFile: MB },
  paramsSchema: NO_PARAMS,
  allowedNetworkModes: ["RESTRICTED"],
  minimumIsolation: "gvisor",
  limits: {
    cpuCores: 1,
    memoryBytes: 256 * MB,
    diskBytes: 128 * MB,
    timeoutSeconds: 120,
    pidLimit: 32,
    maxOutputBytes: 50 * MB,
  },
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
  input: { contentTypes: [], maxFiles: 0, maxBytesPerFile: 0, maxTotalBytes: 0 },
  output: { contentTypes: [], maxBytesPerFile: 0 },
  paramsSchema: NO_PARAMS,
  allowedNetworkModes: ["OFFLINE"],
  minimumIsolation: "microvm",
  limits: {
    cpuCores: 2,
    memoryBytes: 2048 * MB,
    diskBytes: 4096 * MB,
    timeoutSeconds: 900,
    pidLimit: 256,
    maxOutputBytes: 50 * MB,
  },
  idempotent: false,
  availability: {
    status: "unavailable",
    reason:
      "Not on personal devices — your own code is HIGH risk and needs a dedicated verified node.",
  },
};

export const WORKLOADS: readonly WorkloadDefinition[] = [
  IMAGE_TRANSFORM,
  REPO_METADATA,
  CUSTOM_CONTAINER,
];

export function getWorkload(id: string): WorkloadDefinition | undefined {
  return WORKLOADS.find((w) => w.id === id);
}
