import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryCredentialStore } from "./secure-store";
import { AgentTrustStore } from "./trust";

function publicKeyPem() {
  return generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
}

describe("Agent trust store", () => {
  it("requires explicit first-use enrollment and rejects key rotation", async () => {
    const trust = new AgentTrustStore(new MemoryCredentialStore());
    const first = publicKeyPem();
    const second = publicKeyPem();

    await expect(trust.pinCoordinatorKey("https://mesh.test", first, false)).rejects.toThrow(
      "EXPLICIT_KEY_ENROLLMENT_REQUIRED",
    );
    await expect(trust.pinCoordinatorKey("https://mesh.test", first, true)).resolves.toHaveLength(
      64,
    );
    await expect(trust.pinCoordinatorKey("https://mesh.test", first, false)).resolves.toHaveLength(
      64,
    );
    await expect(trust.pinCoordinatorKey("https://mesh.test", second, false)).rejects.toThrow(
      "COORDINATOR_KEY_PIN_MISMATCH",
    );
  });

  it("keeps Agent tokens in the credential-store abstraction", async () => {
    const trust = new AgentTrustStore(new MemoryCredentialStore());
    await trust.saveAgentToken("https://mesh.test", "secret-token");
    await expect(trust.getAgentToken("https://mesh.test")).resolves.toBe("secret-token");
  });
});
