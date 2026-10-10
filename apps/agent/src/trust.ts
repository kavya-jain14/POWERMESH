import { createHash, createPublicKey } from "node:crypto";
import type { CredentialStore } from "./secure-store";

function endpointId(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("COORDINATOR_TLS_REQUIRED");
  }
  return createHash("sha256").update(url.origin).digest("hex").slice(0, 24);
}

export function publicKeyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

export class AgentTrustStore {
  constructor(private readonly credentials: CredentialStore) {}

  async saveAgentToken(endpoint: string, token: string): Promise<void> {
    await this.credentials.set(`agent-token:${endpointId(endpoint)}`, token);
  }

  async getAgentToken(endpoint: string): Promise<string | null> {
    return this.credentials.get(`agent-token:${endpointId(endpoint)}`);
  }

  async pinCoordinatorKey(
    endpoint: string,
    publicKeyPem: string,
    explicitEnrollment: boolean,
  ): Promise<string> {
    const account = `coordinator-key:${endpointId(endpoint)}`;
    const fingerprint = publicKeyFingerprint(publicKeyPem);
    const existing = await this.credentials.get(account);
    if (!existing && !explicitEnrollment) throw new Error("EXPLICIT_KEY_ENROLLMENT_REQUIRED");
    if (existing && existing !== publicKeyPem) throw new Error("COORDINATOR_KEY_PIN_MISMATCH");
    if (!existing) await this.credentials.set(account, publicKeyPem);
    return fingerprint;
  }

  async getPinnedCoordinatorKey(endpoint: string): Promise<string | null> {
    return this.credentials.get(`coordinator-key:${endpointId(endpoint)}`);
  }
}
