import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import {
  canonicalizeOfferManifest,
  type OfferManifest,
  type SignedJobOffer,
} from "@powermesh/contracts";

export interface OfferSigner {
  readonly keyId: string;
  readonly publicKeyPem: string;
  sign(manifest: OfferManifest): string;
}

function keyIdFor(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 24);
}

export function createOfferSigner(privateKeyPem?: string): OfferSigner {
  let privateKey: KeyObject;
  let publicKey: KeyObject;

  if (privateKeyPem) {
    privateKey = createPrivateKey(privateKeyPem);
    publicKey = createPublicKey(privateKey);
  } else {
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }

  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  return {
    keyId: keyIdFor(publicKeyPem),
    publicKeyPem,
    sign(manifest) {
      return sign(null, Buffer.from(canonicalizeOfferManifest(manifest)), privateKey).toString(
        "base64url",
      );
    },
  };
}

export function verifyOfferSignature(offer: SignedJobOffer, publicKeyPem: string): boolean {
  return verify(
    null,
    Buffer.from(canonicalizeOfferManifest(offer.manifest)),
    createPublicKey(publicKeyPem),
    Buffer.from(offer.signature, "base64url"),
  );
}
