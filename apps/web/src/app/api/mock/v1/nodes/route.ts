import { handle } from "@/mock/http";
import { listNodes } from "@/mock/store";

export const dynamic = "force-dynamic";

/** ❓ Kavya: node capability view (dependency handshake §8) — not in API v0 yet. */
export async function GET() {
  return handle((user) => listNodes(user));
}
