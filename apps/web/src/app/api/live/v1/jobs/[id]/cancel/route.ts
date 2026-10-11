import { BridgeError, errorResponse } from "@/server/coordinator";

export const dynamic = "force-dynamic";

/** API v0 has no POST /v1/jobs/:id/cancel yet (master plan §7 lists it). Say so instead of pretending. */
export async function POST() {
  return errorResponse(new BridgeError(501, "UNAVAILABLE", "Cancelling isn't available yet — the coordinator API has no cancel endpoint."));
}
