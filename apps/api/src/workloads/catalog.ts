import {
  type JobSubmission,
  pinnedImageReferenceSchema,
  type WorkloadRequest,
} from "@powermesh/contracts";
import { z } from "zod";

export const imageTransformWorkloadId = "7d8af71b-4a16-4cc2-9c6f-579adb5c0d8f";

const imageTransformParamsSchema = z
  .object({
    format: z.enum(["webp", "jpeg", "png"]),
    maxWidth: z.number().int().min(256).max(4096).multipleOf(64).default(1600),
    quality: z.number().int().min(40).max(95).default(82),
  })
  .strict();

export interface CatalogWorkload {
  definition: JobSubmission["workload"];
  resources: WorkloadRequest;
  input: {
    available: boolean;
    contentTypes: readonly ["image/png", "image/jpeg", "image/webp"];
    maxFiles: number;
    maxBytesPerFile: number;
    maxTotalBytes: number;
  };
  paramsSchema: Record<string, unknown>;
  parseParams(input: unknown): JobSubmission["params"];
}

const imageTransformResources: WorkloadRequest = {
  cpu: 1,
  memoryMb: 512,
  timeoutSeconds: 300,
  maxOutputBytes: 50 * 1024 * 1024,
  networkMode: "OFFLINE",
  allowedHosts: [],
  needsHostMount: false,
  privileged: false,
  dockerSocket: false,
  deviceAccess: false,
  arbitraryImage: false,
};

function imageTransformWorkload(imageReference: string): CatalogWorkload {
  const pinnedReference = pinnedImageReferenceSchema.parse(imageReference);
  const imageDigest = pinnedReference.slice(pinnedReference.lastIndexOf("@") + 1);
  return {
    definition: {
      id: imageTransformWorkloadId,
      name: "image-transform",
      version: "1.0.0",
      imageDigest,
      imageReference: pinnedReference,
    },
    resources: imageTransformResources,
    input: {
      available: false,
      contentTypes: ["image/png", "image/jpeg", "image/webp"],
      maxFiles: 12,
      maxBytesPerFile: 10 * 1024 * 1024,
      maxTotalBytes: 50 * 1024 * 1024,
    },
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["format", "maxWidth", "quality"],
      properties: {
        format: { type: "string", enum: ["webp", "jpeg", "png"], title: "Format" },
        maxWidth: {
          type: "integer",
          minimum: 256,
          maximum: 4096,
          multipleOf: 64,
          default: 1600,
          title: "Maximum width",
          "x-unit": "px",
        },
        quality: {
          type: "integer",
          minimum: 40,
          maximum: 95,
          default: 82,
          title: "Quality",
        },
      },
    },
    parseParams: (input) => imageTransformParamsSchema.parse(input),
  };
}

export class WorkloadCatalog {
  private readonly entries = new Map<string, CatalogWorkload>();

  constructor(workloads: CatalogWorkload[] = []) {
    for (const workload of workloads) {
      if (this.entries.has(workload.definition.id)) throw new Error("DUPLICATE_WORKLOAD_ID");
      this.entries.set(workload.definition.id, workload);
    }
  }

  list(): CatalogWorkload[] {
    return [...this.entries.values()];
  }

  get(id: string): CatalogWorkload | null {
    return this.entries.get(id) ?? null;
  }
}

export function createConfiguredWorkloadCatalog(
  imageReference = process.env.POWERMESH_IMAGE_TRANSFORM_IMAGE,
): WorkloadCatalog {
  return new WorkloadCatalog(imageReference ? [imageTransformWorkload(imageReference)] : []);
}

export function createTestWorkloadCatalog(digestCharacter = "a"): WorkloadCatalog {
  const digest = digestCharacter.repeat(64);
  return new WorkloadCatalog([
    imageTransformWorkload(`ghcr.io/powermesh/image-transform@sha256:${digest}`),
  ]);
}
