import { handle } from "@/mock/http";
import { agentState } from "@/mock/store";

export const dynamic = "force-dynamic";

/**
 * Simulates the Agent's local API (Q21 / ADR-002): in production the Agent serves the Provider Console and
 * this endpoint on http://127.0.0.1:4765. It answers even while the coordinator is down.
 */
export async function GET() {
  return handle((user) => agentState(user));
}
