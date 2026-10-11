import { handle, readJson } from "@/mock/http";
import { agentSetAvailability, MockApiError } from "@/mock/store";

export const dynamic = "force-dynamic";

/** Pause or resume new offers (Q12, Q21). Never stops the current job. */
export async function POST(req: Request) {
  return handle(async (user) => {
    const body = await readJson<{ available?: unknown }>(req);
    if (typeof body.available !== "boolean") throw new MockApiError(400, "VALIDATION_FAILED", "available must be true or false.", { available: "Required." });
    return agentSetAvailability(user, body.available);
  });
}
