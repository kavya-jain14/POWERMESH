import type { OfferDecisionRequest } from "@/contracts-draft/types";
import { handle, readJson } from "@/mock/http";
import { agentDecideOffer, MockApiError } from "@/mock/store";

export const dynamic = "force-dynamic";

/** Q21: decisions go to the Agent, which signs them and mirrors them to the coordinator. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async (user) => {
    const body = await readJson<OfferDecisionRequest>(req);
    if (body.decision !== "approve" && body.decision !== "decline") {
      throw new MockApiError(400, "VALIDATION_FAILED", "Decision must be approve or decline.", {
        decision: "Use approve or decline.",
      });
    }
    return agentDecideOffer(id, body.decision, user);
  });
}
