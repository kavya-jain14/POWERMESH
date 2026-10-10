import { z } from "zod";
import { createEgressProxy } from "./proxy";

const environment = z
  .object({
    POWERMESH_ALLOWED_HOSTS: z.string(),
    POWERMESH_EGRESS_MAX_REQUESTS: z.coerce.number().int().min(1).max(10_000),
    POWERMESH_EGRESS_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1024 * 1024 * 1024),
    POWERMESH_EGRESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(3_600_000),
  })
  .parse(process.env);

const allowedHosts = z
  .array(z.string().min(1).max(253))
  .max(20)
  .parse(JSON.parse(environment.POWERMESH_ALLOWED_HOSTS));
const server = createEgressProxy({
  allowedHosts,
  maxRequests: environment.POWERMESH_EGRESS_MAX_REQUESTS,
  maxBytes: environment.POWERMESH_EGRESS_MAX_BYTES,
  timeoutMs: environment.POWERMESH_EGRESS_TIMEOUT_MS,
});
server.listen(8080, "0.0.0.0");
