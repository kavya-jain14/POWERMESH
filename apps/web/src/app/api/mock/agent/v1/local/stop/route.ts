import { handle } from "@/mock/http";
import { agentStop } from "@/mock/store";

export const dynamic = "force-dynamic";

/** Local emergency stop (Q21, Q22): handled by the Agent on the device, never waits for the coordinator. */
export async function POST() {
  return handle((user) => agentStop(user));
}
