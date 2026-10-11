import { handle, readJson } from "@/mock/http";
import { getPolicy, putPolicy } from "@/mock/store";
import type { ProviderPolicy } from "@/contracts-draft/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle((user) => getPolicy(id, user));
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async (user) => putPolicy(id, await readJson<Partial<ProviderPolicy>>(req), user));
}
