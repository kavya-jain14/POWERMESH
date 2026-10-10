import { handle } from "@/mock/http";
import { agentState } from "@/mock/store";

export const dynamic = "force-dynamic";

/** Mock of the local Agent's loopback endpoint (G1 §6 Q9). Works while the coordinator is down. */
export async function GET() {
  return handle((user) => agentState(user));
}
