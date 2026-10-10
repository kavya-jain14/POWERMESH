import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { enrollAgent, loadAgentTrust } from "./enrollment";
import { MemoryCredentialStore } from "./secure-store";
import { AgentTrustStore } from "./trust";

describe("Agent enrollment", () => {
  it("pins the confirmed key and stores the issued token", async () => {
    const publicKey = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    const trust = new AgentTrustStore(new MemoryCredentialStore());
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url.endsWith("/v1/signing-key")) {
        return Response.json({ algorithm: "Ed25519", keyId: "test-key-id", publicKey });
      }
      return Response.json(
        {
          node: { id: "11111111-1111-4111-8111-111111111111" },
          agentToken: "a".repeat(43),
        },
        { status: 201 },
      );
    };

    const enrolled = await enrollAgent({
      endpoint: "https://mesh.test",
      enrollmentKey: "invite",
      registration: {
        ownerId: "22222222-2222-4222-8222-222222222222",
        nodeName: "provider",
        os: "linux",
        architecture: "x64",
        agentVersion: "0.1.0",
        cpuCores: 4,
        memoryMb: 4096,
        networkModes: ["OFFLINE"],
        isolationLevels: ["GVISOR"],
      },
      trust,
      confirmFingerprint: async () => true,
      fetcher,
    });

    expect(enrolled.nodeId).toBe("11111111-1111-4111-8111-111111111111");
    expect(calls).toHaveLength(2);
    await expect(loadAgentTrust("https://mesh.test", trust)).resolves.toMatchObject({
      agentToken: "a".repeat(43),
      publicKey,
    });
  });
});
