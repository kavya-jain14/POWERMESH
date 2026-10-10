import { handle } from "@/mock/http";
import { cancelJob } from "@/mock/store";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle((user) => cancelJob(id, user));
}
