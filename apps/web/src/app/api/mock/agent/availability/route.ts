import { handle, readJson } from "@/mock/http";
import { agentSetAvailability } from "@/mock/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async (user) => {
    const body = await readJson<{ available: boolean }>(req);
    return agentSetAvailability(user, Boolean(body.available));
  });
}
