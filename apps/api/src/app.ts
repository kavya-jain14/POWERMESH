import { classifyRisk, workloadRequestSchema } from "@powermesh/contracts";
import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", service: "powermesh-api" }));

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

  return app;
}
