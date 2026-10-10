import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createAgentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length >= 32 ? token : null;
}

export function constantTimeTokenMatch(left: string, right: string): boolean {
  const leftHash = Buffer.from(hashAgentToken(left));
  const rightHash = Buffer.from(hashAgentToken(right));
  return leftHash.length === rightHash.length && timingSafeEqual(leftHash, rightHash);
}
