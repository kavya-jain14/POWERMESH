import { z } from "zod";
import { imageDigestSchema, workloadDefinitionSchema } from "./entities";
import { riskTierSchema, workloadRequestSchema } from "./schemas";

export const offerNonceSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const offerManifestSchema = z.object({
  version: z.literal(1),
  offerId: z.string().uuid(),
  jobId: z.string().uuid(),
  nodeId: z.string().uuid(),
  workload: workloadDefinitionSchema,
  resources: workloadRequestSchema,
  params: z.record(z.string(), z.string()),
  inputDigests: z.array(imageDigestSchema),
  riskTier: riskTierSchema,
  nonce: offerNonceSchema,
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
});

export const signedJobOfferSchema = z.object({
  id: z.string().uuid(),
  manifest: offerManifestSchema,
  signature: z.string().min(32),
  signatureAlgorithm: z.literal("Ed25519"),
  keyId: z.string().min(8).max(128),
  approvedAt: z.string().datetime({ offset: true }).nullable(),
  claimedAt: z.string().datetime({ offset: true }).nullable(),
  leaseUntil: z.string().datetime({ offset: true }).nullable(),
});

export const offerCreationSchema = z.object({
  nodeId: z.string().uuid(),
  ttlSeconds: z.number().int().min(30).max(900).default(120),
});

export const offerClaimSchema = z.object({
  nonce: offerNonceSchema,
  leaseSeconds: z.number().int().min(15).max(300).default(60),
});

export type OfferManifest = z.infer<typeof offerManifestSchema>;
export type SignedJobOffer = z.infer<typeof signedJobOfferSchema>;

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | CanonicalObject;
type CanonicalObject = { [key: string]: CanonicalValue };

function normalize(value: CanonicalValue): CanonicalValue {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

export function canonicalizeOfferManifest(manifest: OfferManifest): string {
  const parsed = offerManifestSchema.parse(manifest);
  return JSON.stringify(normalize(parsed as CanonicalObject));
}
