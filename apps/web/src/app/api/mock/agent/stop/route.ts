import { handle } from "@/mock/http";
import { agentStop } from "@/mock/store";

export const dynamic = "force-dynamic";

/** Emergency stop — handled locally by the Agent, independent of the coordinator (master plan §4). */
export async function POST() {
  return handle((user) => agentStop(user));
}
