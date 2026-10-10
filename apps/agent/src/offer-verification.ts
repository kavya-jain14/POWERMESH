import { createHash, createPublicKey, verify } from "node:crypto";
import {
  canonicalizeOfferManifest,
  type SignedJobOffer,
  signedJobOfferSchema,
} from "@powermesh/contracts";

export type OfferVerificationResult =
  | { valid: true; offer: SignedJobOffer }
  | { valid: false; reason: "INVALID_OFFER" | "UNTRUSTED_KEY" | "INVALID_SIGNATURE" };

export function coordinatorKeyId(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 24);
}

export function verifyCoordinatorOffer(
  input: unknown,
  trustedPublicKeyPem: string,
): OfferVerificationResult {
  const parsed = signedJobOfferSchema.safeParse(input);
  if (!parsed.success) return { valid: false, reason: "INVALID_OFFER" };
  if (parsed.data.keyId !== coordinatorKeyId(trustedPublicKeyPem)) {
    return { valid: false, reason: "UNTRUSTED_KEY" };
  }

  const valid = verify(
    null,
    Buffer.from(canonicalizeOfferManifest(parsed.data.manifest)),
    createPublicKey(trustedPublicKeyPem),
    Buffer.from(parsed.data.signature, "base64url"),
  );
  return valid
    ? { valid: true, offer: parsed.data }
    : { valid: false, reason: "INVALID_SIGNATURE" };
}
