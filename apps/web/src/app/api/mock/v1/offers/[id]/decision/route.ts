import { handle, readJson } from "@/mock/http";
import { decideOffer, MockApiError } from "@/mock/store";
import type { OfferDecisionRequest } from "@/contracts-draft/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async (user) => {
    const body = await readJson<OfferDecisionRequest>(req);
    if (body.decision !== "approve" && body.decision !== "decline") {
      throw new MockApiError(400, "VALIDATION_FAILED", "Decision must be approve or decline.");
    }
    return decideOffer(id, body.decision, user);
  });
}
