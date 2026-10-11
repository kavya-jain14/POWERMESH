import { handle } from "@/mock/http";
import { assertCoordinatorUp, getOffer } from "@/mock/store";

export const dynamic = "force-dynamic";

/** Q15/Q21: offers are read from the coordinator, like every other provider view. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle((user) => {
    assertCoordinatorUp();
    return getOffer(id, user);
  });
}
