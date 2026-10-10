import { handle } from "@/mock/http";
import { getOffer } from "@/mock/store";

export const dynamic = "force-dynamic";

/** Served by the local Agent in the proposed design (G1 §6 Q9) — so no coordinator check. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle((user) => getOffer(id, user));
}
