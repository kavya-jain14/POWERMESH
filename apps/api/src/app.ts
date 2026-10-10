import {
  classifyRisk,
  jobSubmissionSchema,
  providerHeartbeatSchema,
  providerRegistrationSchema,
  workloadRequestSchema,
} from "@powermesh/contracts";
import Fastify from "fastify";
import { z } from "zod";
import { type CoordinatorStore, MemoryCoordinatorStore } from "./store";

interface BuildAppOptions {
  store?: CoordinatorStore;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false });
  const store = options.store ?? new MemoryCoordinatorStore();

  app.addHook("onClose", async () => {
    await store.close();
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "powermesh-api",
    storage: store.kind,
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

    const node = await store.registerProvider(parsed.data);
    return reply.code(201).send({ node });
  });

  app.post("/v1/nodes/:id/heartbeat", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = providerHeartbeatSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "INVALID_HEARTBEAT" });
    }

    const node = await store.heartbeatProvider(params.data.id, body.data);
    if (!node) return reply.code(404).send({ error: "NODE_NOT_FOUND" });
    return { node };
  });

  return app;
}
