import { handle } from "@/mock/http";
import { assertCoordinatorUp, getJob } from "@/mock/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle((user) => {
    assertCoordinatorUp();
    return getJob(id, user);
  });
}
