import { randomBytes, randomUUID } from "node:crypto";
import {
  classifyRisk,
  jobSubmissionSchema,
  offerClaimSchema,
  offerCreationSchema,
  providerHeartbeatSchema,
  providerRegistrationSchema,
  type SignedJobOffer,
  workloadRequestSchema,
} from "@powermesh/contracts";
import Fastify from "fastify";
import { z } from "zod";
import {
  constantTimeTokenMatch,
  createAgentToken,
  hashAgentToken,
  readBearerToken,
} from "./auth/tokens";
import { createOfferSigner, type OfferSigner } from "./offers/signing";
import { type CoordinatorStore, MemoryCoordinatorStore } from "./store";

interface BuildAppOptions {
  store?: CoordinatorStore;
  offerSigner?: OfferSigner;
  coordinatorKey?: string;
  now?: () => Date;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false });
  const store = options.store ?? new MemoryCoordinatorStore();
  const offerSigner = options.offerSigner ?? createOfferSigner();
  const coordinatorKey = options.coordinatorKey ?? process.env.POWERMESH_COORDINATOR_KEY;
  const now = options.now ?? (() => new Date());

  async function authenticateNode(nodeId: string, authorization: string | undefined) {
    const token = readBearerToken(authorization);
    return token ? store.authenticateProvider(nodeId, hashAgentToken(token)) : false;
  }

  function coordinatorIsAuthorized(header: string | string[] | undefined): boolean {
    const presented = Array.isArray(header) ? header[0] : header;
    return Boolean(
      coordinatorKey && presented && constantTimeTokenMatch(presented, coordinatorKey),
    );
  }

  function failureStatus(reason: string): number {
    if (reason.endsWith("NOT_FOUND")) return 404;
    if (reason === "OFFER_EXPIRED") return 410;
    if (reason === "CAPABILITY_MISMATCH") return 422;
    if (reason === "NODE_MISMATCH") return 403;
    return 409;
  }

  app.addHook("onClose", async () => {
    await store.close();
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "powermesh-api",
    storage: store.kind,
    offerSigningKeyId: offerSigner.keyId,
  }));

  app.get("/v1/signing-key", async () => ({
    algorithm: "Ed25519",
    keyId: offerSigner.keyId,
    publicKey: offerSigner.publicKeyPem,
  }));

  app.post("/v1/risk/classify", async (request, reply) => {
    const parsed = workloadRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_WORKLOAD",
        issues: parsed.error.issues,
      });
    }

    return classifyRisk(parsed.data);
  });

  app.post("/v1/jobs", async (request, reply) => {
    const parsed = jobSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_JOB", issues: parsed.error.issues });
    }

    const risk = classifyRisk(parsed.data.resources);
    if (!risk.executableInMvp) {
      return reply.code(422).send({ error: "WORKLOAD_NOT_EXECUTABLE", risk });
    }

    const job = await store.createPolicyCheckedJob(parsed.data, risk);
    return reply.code(201).send({ job, risk });
  });

  app.get("/v1/jobs/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_JOB_ID" });

    const job = await store.findJob(params.data.id);
    if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    return job;
  });

  app.post("/v1/nodes/register", async (request, reply) => {
    const parsed = providerRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_NODE", issues: parsed.error.issues });
    }

    const currentToken = readBearerToken(request.headers.authorization);
    const agentToken = createAgentToken();
    const node = await store.registerProvider(
      parsed.data,
      hashAgentToken(agentToken),
      currentToken ? hashAgentToken(currentToken) : undefined,
    );
    if (!node) return reply.code(401).send({ error: "NODE_CREDENTIAL_REQUIRED" });
    return reply.code(201).send({ node, agentToken });
  });

  app.post("/v1/nodes/:id/heartbeat", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = providerHeartbeatSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "INVALID_HEARTBEAT" });
    }
    if (!(await authenticateNode(params.data.id, request.headers.authorization))) {
      return reply.code(401).send({ error: "INVALID_AGENT_CREDENTIAL" });
    }

    const node = await store.heartbeatProvider(params.data.id, body.data);
    if (!node) return reply.code(404).send({ error: "NODE_NOT_FOUND" });
    return { node };
  });

  app.post("/v1/jobs/:jobId/offers", async (request, reply) => {
    if (!coordinatorIsAuthorized(request.headers["x-powermesh-coordinator-key"])) {
      return reply.code(401).send({ error: "INVALID_COORDINATOR_CREDENTIAL" });
    }

    const params = z.object({ jobId: z.string().uuid() }).safeParse(request.params);
    const body = offerCreationSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "INVALID_OFFER" });
    }

    const [job, node] = await Promise.all([
      store.findJob(params.data.jobId),
      store.findProvider(body.data.nodeId),
    ]);
    if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    if (!node) return reply.code(404).send({ error: "NODE_NOT_FOUND" });

    const issuedAt = now();
    const offerId = randomUUID();
    const manifest = {
      version: 1 as const,
      offerId,
      jobId: job.id,
      nodeId: node.id,
      workload: job.workload,
      resources: job.resources,
      params: job.params,
      inputDigests: job.inputDigests,
      riskTier: job.riskTier,
      nonce: randomBytes(32).toString("hex"),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + body.data.ttlSeconds * 1_000).toISOString(),
    };
    const offer: SignedJobOffer = {
      id: offerId,
      manifest,
      signature: offerSigner.sign(manifest),
      signatureAlgorithm: "Ed25519",
      keyId: offerSigner.keyId,
      approvedAt: null,
      claimedAt: null,
      leaseUntil: null,
    };

    const result = await store.createOffer(offer);
    if (!result.ok) {
      return reply.code(failureStatus(result.reason)).send({ error: result.reason });
    }
    return reply.code(201).send({ offer: result.value });
  });

  app.get("/v1/nodes/:nodeId/offers", async (request, reply) => {
    const params = z.object({ nodeId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_NODE_ID" });
    if (!(await authenticateNode(params.data.nodeId, request.headers.authorization))) {
      return reply.code(401).send({ error: "INVALID_AGENT_CREDENTIAL" });
    }

    const offers = await store.listPendingOffers(params.data.nodeId, now().toISOString());
    return { offers };
  });

  app.post("/v1/nodes/:nodeId/offers/:offerId/approve", async (request, reply) => {
    const params = z
      .object({ nodeId: z.string().uuid(), offerId: z.string().uuid() })
      .safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_OFFER_ID" });
    if (!(await authenticateNode(params.data.nodeId, request.headers.authorization))) {
      return reply.code(401).send({ error: "INVALID_AGENT_CREDENTIAL" });
    }

    const result = await store.approveOffer(
      params.data.offerId,
      params.data.nodeId,
      now().toISOString(),
    );
    if (!result.ok) {
      return reply.code(failureStatus(result.reason)).send({ error: result.reason });
    }
    return { offer: result.value };
  });

  app.post("/v1/nodes/:nodeId/offers/:offerId/claim", async (request, reply) => {
    const params = z
      .object({ nodeId: z.string().uuid(), offerId: z.string().uuid() })
      .safeParse(request.params);
    const body = offerClaimSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "INVALID_CLAIM" });
    }
    if (!(await authenticateNode(params.data.nodeId, request.headers.authorization))) {
      return reply.code(401).send({ error: "INVALID_AGENT_CREDENTIAL" });
    }

    const claimedAt = now();
    const result = await store.claimOffer(
      params.data.offerId,
      params.data.nodeId,
      body.data.nonce,
      claimedAt.toISOString(),
      new Date(claimedAt.getTime() + body.data.leaseSeconds * 1_000).toISOString(),
    );
    if (!result.ok) {
      return reply.code(failureStatus(result.reason)).send({ error: result.reason });
    }
    return { offer: result.value };
  });

  return app;
}
