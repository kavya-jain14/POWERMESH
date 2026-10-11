import { randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import {
  classifyRisk,
  executionCompletionSchema,
  jobCreationSchema,
  offerClaimSchema,
  offerCreationSchema,
  providerHeartbeatSchema,
  providerRegistrationSchema,
  requesterRegistrationSchema,
  workloadRequestSchema,
} from "@powermesh/contracts";
import Fastify from "fastify";
import { z } from "zod";
import { GeminiClient, geminiConfigFromEnv } from "./ai/gemini";
import { RiskExplainer, riskExplainRequestSchema } from "./ai/risk-explainer";
import {
  constantTimeTokenMatch,
  createAgentToken,
  hashAgentToken,
  readBearerToken,
} from "./auth/tokens";
import { CoordinatorMatcher } from "./matcher";
import { createOfferSigner, type OfferSigner } from "./offers/signing";
import { type CoordinatorStore, MemoryCoordinatorStore } from "./store";
import { createConfiguredWorkloadCatalog, type WorkloadCatalog } from "./workloads/catalog";

interface BuildAppOptions {
  store?: CoordinatorStore;
  offerSigner?: OfferSigner;
  coordinatorKey?: string;
  enrollmentKey?: string;
  now?: () => Date;
  rateLimitMax?: number;
  workloadCatalog?: WorkloadCatalog;
  autoMatch?: boolean;
  riskExplainer?: RiskExplainer;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const store = options.store ?? new MemoryCoordinatorStore();
  const offerSigner = options.offerSigner ?? createOfferSigner();
  const coordinatorKey = options.coordinatorKey ?? process.env.POWERMESH_COORDINATOR_KEY;
  const enrollmentKey = options.enrollmentKey ?? process.env.POWERMESH_ENROLLMENT_KEY;
  const now = options.now ?? (() => new Date());
  const workloadCatalog = options.workloadCatalog ?? createConfiguredWorkloadCatalog();
  const matcher = new CoordinatorMatcher(store, offerSigner, now);
  const autoMatch = options.autoMatch ?? true;
  const riskExplainer =
    options.riskExplainer ?? new RiskExplainer(new GeminiClient(geminiConfigFromEnv()));

  app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? 100,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({ statusCode: 429, error: "RATE_LIMITED" }),
  });

  async function authenticateNode(nodeId: string, authorization: string | undefined) {
    const token = readBearerToken(authorization) ?? "";
    return store.authenticateProvider(nodeId, hashAgentToken(token));
  }

  async function authenticateRequester(authorization: string | undefined) {
    const token = readBearerToken(authorization) ?? "";
    return store.authenticateRequester(hashAgentToken(token));
  }

  function enrollmentIsAuthorized(header: string | string[] | undefined): boolean {
    const presented = Array.isArray(header) ? header[0] : header;
    return Boolean(enrollmentKey && presented && constantTimeTokenMatch(presented, enrollmentKey));
  }

  function coordinatorIsAuthorized(header: string | string[] | undefined): boolean {
    const presented = Array.isArray(header) ? header[0] : header;
    return Boolean(
      coordinatorKey && presented && constantTimeTokenMatch(presented, coordinatorKey),
    );
  }

  function failureStatus(reason: string): number {
    if (reason.endsWith("NOT_FOUND")) return 404;
    if (reason === "OFFER_EXPIRED" || reason === "LEASE_EXPIRED") return 410;
    if (reason === "CAPABILITY_MISMATCH") return 422;
    if (reason === "NODE_MISMATCH") return 403;
    return 409;
  }

  app.after(() => {
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

    app.get("/v1/workloads", async () => ({
      workloads: workloadCatalog.list().map(({ definition, resources, input, paramsSchema }) => ({
        ...definition,
        resources,
        input,
        paramsSchema,
      })),
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

    // Advisory text only: the tier in the response is echoed from the request, never from the model.
    app.post(
      "/v1/risk/explain",
      { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const requester = await authenticateRequester(request.headers.authorization);
        if (!requester) {
          return reply.code(401).send({ error: "INVALID_REQUESTER_CREDENTIAL" });
        }
        const parsed = riskExplainRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "INVALID_RISK", issues: parsed.error.issues });
        }
        const explanation = await riskExplainer.explain(parsed.data);
        return { tier: parsed.data.tier, explanation };
      },
    );

    app.post(
      "/v1/requesters/register",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (!enrollmentIsAuthorized(request.headers["x-powermesh-enrollment-key"])) {
          return reply.code(401).send({ error: "INVALID_ENROLLMENT_CREDENTIAL" });
        }
        const parsed = requesterRegistrationSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "INVALID_REQUESTER", issues: parsed.error.issues });
        }

        const requesterToken = createAgentToken();
        const requester = await store.registerRequester(
          parsed.data,
          hashAgentToken(requesterToken),
        );
        return reply.code(201).send({ requester, requesterToken });
      },
    );

    app.post(
      "/v1/jobs",
      { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const requester = await authenticateRequester(request.headers.authorization);
        if (!requester) {
          return reply.code(401).send({ error: "INVALID_REQUESTER_CREDENTIAL" });
        }

        const parsed = jobCreationSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "INVALID_JOB", issues: parsed.error.issues });
        }

        const catalogWorkload = workloadCatalog.get(parsed.data.workloadId);
        if (!catalogWorkload) {
          return reply.code(404).send({ error: "WORKLOAD_NOT_FOUND" });
        }
        if (!catalogWorkload.input.available && parsed.data.inputDigests.length > 0) {
          return reply.code(422).send({ error: "ARTIFACT_TRANSPORT_UNAVAILABLE" });
        }
        if (parsed.data.inputDigests.length > catalogWorkload.input.maxFiles) {
          return reply.code(400).send({ error: "TOO_MANY_INPUTS" });
        }
        let params: ReturnType<typeof catalogWorkload.parseParams>;
        try {
          params = catalogWorkload.parseParams(parsed.data.params);
        } catch {
          return reply.code(400).send({ error: "INVALID_WORKLOAD_PARAMS" });
        }
        const risk = classifyRisk(catalogWorkload.resources);
        if (!risk.executableInMvp) {
          return reply.code(422).send({ error: "WORKLOAD_NOT_EXECUTABLE", risk });
        }

        const job = await store.createPolicyCheckedJob(
          {
            requesterId: requester.id,
            workload: catalogWorkload.definition,
            resources: catalogWorkload.resources,
            params,
            inputDigests: parsed.data.inputDigests,
          },
          risk,
        );
        if (autoMatch) await matcher.matchJob(job).catch(() => null);
        return reply.code(201).send({ job: (await store.findJob(job.id)) ?? job, risk });
      },
    );

    app.get(
      "/v1/jobs/:id",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: "INVALID_JOB_ID" });

        const requester = await authenticateRequester(request.headers.authorization);
        const coordinatorAuthorized = coordinatorIsAuthorized(
          request.headers["x-powermesh-coordinator-key"],
        );
        if (!requester && !coordinatorAuthorized) {
          return reply.code(401).send({ error: "INVALID_REQUESTER_CREDENTIAL" });
        }

        const job = await store.findJob(params.data.id);
        if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
        if (requester && job.requesterId !== requester.id) {
          return reply.code(404).send({ error: "JOB_NOT_FOUND" });
        }
        return job;
      },
    );

    app.post(
      "/v1/nodes/register",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const parsed = providerRegistrationSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: "INVALID_NODE", issues: parsed.error.issues });
        }

        const currentToken = readBearerToken(request.headers.authorization);
        if (
          !currentToken &&
          !enrollmentIsAuthorized(request.headers["x-powermesh-enrollment-key"])
        ) {
          return reply.code(401).send({ error: "INVALID_ENROLLMENT_CREDENTIAL" });
        }
        const agentToken = createAgentToken();
        const node = await store.registerProvider(
          parsed.data,
          hashAgentToken(agentToken),
          currentToken ? hashAgentToken(currentToken) : undefined,
        );
        if (!node) return reply.code(401).send({ error: "NODE_CREDENTIAL_REQUIRED" });
        return reply.code(201).send({ node, agentToken });
      },
    );

    app.post(
      "/v1/nodes/:id/heartbeat",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
        const body = providerHeartbeatSchema.safeParse(request.body);
        if (!params.success || !body.success) {
          return reply.code(400).send({ error: "INVALID_HEARTBEAT" });
        }
        if (!(await authenticateNode(params.data.id, request.headers.authorization))) {
          return reply.code(401).send({ error: "INVALID_AGENT_CREDENTIAL" });
        }

        const registered = await store.findProvider(params.data.id);
        if (!registered) return reply.code(404).send({ error: "NODE_NOT_FOUND" });
        if (
          body.data.availableCpu > registered.cpuCores ||
          body.data.availableMemoryMb > registered.memoryMb ||
          (body.data.availableGpuCount ?? 0) > (registered.accelerators ?? []).length
        ) {
          return reply.code(400).send({ error: "INVALID_ADVERTISED_CAPACITY" });
        }

        const node = await store.heartbeatProvider(params.data.id, body.data);
        if (!node) return reply.code(404).send({ error: "NODE_NOT_FOUND" });
        if (autoMatch && node.status === "ONLINE") await matcher.sweep().catch(() => 0);
        return { node };
      },
    );

    app.post(
      "/v1/jobs/:jobId/offers",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request, reply) => {
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

        const result = await matcher.createOfferForNode(job, node, body.data.ttlSeconds);
        if (!result.ok) {
          return reply.code(failureStatus(result.reason)).send({ error: result.reason });
        }
        return reply.code(201).send({ offer: result.value });
      },
    );

    app.get(
      "/v1/nodes/:nodeId/offers",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const params = z.object({ nodeId: z.string().uuid() }).safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: "INVALID_NODE_ID" });
        if (!(await authenticateNode(params.data.nodeId, request.headers.authorization))) {
          return reply.code(401).send({ error: "INVALID_AGENT_CREDENTIAL" });
        }

        const offers = await store.listPendingOffers(params.data.nodeId, now().toISOString());
        return { offers };
      },
    );

    app.post(
      "/v1/nodes/:nodeId/offers/:offerId/approve",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request, reply) => {
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
      },
    );

    app.post(
      "/v1/nodes/:nodeId/jobs/:jobId/start",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const params = z
          .object({ nodeId: z.string().uuid(), jobId: z.string().uuid() })
          .safeParse(request.params);
        if (!params.success) return reply.code(400).send({ error: "INVALID_JOB_ID" });
        if (!(await authenticateNode(params.data.nodeId, request.headers.authorization))) {
          return reply.code(401).send({ error: "INVALID_AGENT_CREDENTIAL" });
        }
        const result = await store.transitionAssignedJob(
          params.data.jobId,
          params.data.nodeId,
          "RUNNING",
          "PROVIDER_AGENT",
          randomUUID(),
        );
        if (!result.ok) {
          return reply.code(failureStatus(result.reason)).send({ error: result.reason });
        }
        return { job: result.value };
      },
    );

    app.post(
      "/v1/nodes/:nodeId/jobs/:jobId/complete",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const params = z
          .object({ nodeId: z.string().uuid(), jobId: z.string().uuid() })
          .safeParse(request.params);
        const completion = executionCompletionSchema.safeParse(request.body);
        if (!params.success || !completion.success) {
          return reply.code(400).send({ error: "INVALID_EXECUTION_RESULT" });
        }
        if (!(await authenticateNode(params.data.nodeId, request.headers.authorization))) {
          return reply.code(401).send({ error: "INVALID_AGENT_CREDENTIAL" });
        }

        const assignedJob = await store.findJob(params.data.jobId);
        if (!assignedJob) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
        const outputWithinLimits =
          completion.data.stdout.sizeBytes + completion.data.stderr.sizeBytes <=
          assignedJob.resources.maxOutputBytes;
        const gpuResultExpected = assignedJob.resources.accelerator === "NVIDIA_CUDA";
        const gpuResultMatches = completion.data.resultSummary
          ? gpuResultExpected &&
            completion.data.resultSummary.matrixSize === Number(assignedJob.params.matrixSize) &&
            completion.data.resultSummary.iterations === Number(assignedJob.params.iterations)
          : !gpuResultExpected;

        const failed =
          completion.data.timedOut ||
          completion.data.outputTruncated ||
          !completion.data.outputValidated ||
          !outputWithinLimits ||
          !gpuResultMatches ||
          completion.data.exitCode !== 0;

        if (!failed && completion.data.resultSummary) {
          const saved = await store.saveResultSummary(
            params.data.jobId,
            params.data.nodeId,
            completion.data.resultSummary,
          );
          if (!saved.ok) {
            return reply.code(failureStatus(saved.reason)).send({ error: saved.reason });
          }
        }
        const first = await store.transitionAssignedJob(
          params.data.jobId,
          params.data.nodeId,
          failed ? "FAILED" : "VALIDATING",
          "PROVIDER_AGENT",
          randomUUID(),
          { ...completion.data, outputWithinLimits, gpuResultMatches },
        );
        if (!first.ok) {
          return reply.code(failureStatus(first.reason)).send({ error: first.reason });
        }
        if (failed) return { job: first.value };

        const validated = await store.transitionAssignedJob(
          params.data.jobId,
          params.data.nodeId,
          "SUCCEEDED",
          "COORDINATOR_VALIDATOR",
          randomUUID(),
          {
            stdoutDigest: completion.data.stdout.digest,
            stderrDigest: completion.data.stderr.digest,
          },
        );
        if (!validated.ok) {
          return reply.code(failureStatus(validated.reason)).send({ error: validated.reason });
        }
        return { job: validated.value };
      },
    );

    app.post(
      "/v1/nodes/:nodeId/offers/:offerId/claim",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request, reply) => {
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
      },
    );
  });

  return app;
}
