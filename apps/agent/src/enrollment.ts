import { type ProviderRegistration, providerRegistrationSchema } from "@powermesh/contracts";
import { z } from "zod";
import type { AgentTrustStore } from "./trust";
import { publicKeyFingerprint } from "./trust";

const signingKeyResponseSchema = z.object({
  algorithm: z.literal("Ed25519"),
  keyId: z.string().min(8),
  publicKey: z.string().includes("BEGIN PUBLIC KEY"),
});

const registrationResponseSchema = z.object({
  node: z.object({ id: z.string().uuid() }).passthrough(),
  agentToken: z.string().min(32),
});

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface EnrollmentOptions {
  endpoint: string;
  enrollmentKey: string;
  registration: ProviderRegistration;
  trust: AgentTrustStore;
  confirmFingerprint: (fingerprint: string) => Promise<boolean>;
  fetcher?: Fetcher;
}

export function coordinatorOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  const loopbackHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new Error("COORDINATOR_TLS_REQUIRED");
  }
  return url.origin;
}

async function fetchSigningKey(origin: string, fetcher: Fetcher) {
  const response = await fetcher(`${origin}/v1/signing-key`);
  if (!response.ok) throw new Error("SIGNING_KEY_FETCH_FAILED");
  return signingKeyResponseSchema.parse(await response.json());
}

export async function enrollAgent(options: EnrollmentOptions) {
  const registration = providerRegistrationSchema.parse(options.registration);
  const origin = coordinatorOrigin(options.endpoint);
  const fetcher = options.fetcher ?? fetch;
  const signingKey = await fetchSigningKey(origin, fetcher);
  const fingerprint = publicKeyFingerprint(signingKey.publicKey);
  if (!(await options.confirmFingerprint(fingerprint))) throw new Error("KEY_ENROLLMENT_REJECTED");
  await options.trust.pinCoordinatorKey(origin, signingKey.publicKey, true);

  const response = await fetcher(`${origin}/v1/nodes/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-powermesh-enrollment-key": options.enrollmentKey,
    },
    body: JSON.stringify(registration),
  });
  if (!response.ok) throw new Error("AGENT_ENROLLMENT_FAILED");
  const enrolled = registrationResponseSchema.parse(await response.json());
  await options.trust.saveAgentToken(origin, enrolled.agentToken);
  return { nodeId: enrolled.node.id, fingerprint };
}

export async function loadAgentTrust(endpoint: string, trust: AgentTrustStore) {
  const origin = coordinatorOrigin(endpoint);
  const [agentToken, publicKey] = await Promise.all([
    trust.getAgentToken(origin),
    trust.getPinnedCoordinatorKey(origin),
  ]);
  if (!agentToken || !publicKey) throw new Error("AGENT_NOT_ENROLLED");
  return { origin, agentToken, publicKey };
}
