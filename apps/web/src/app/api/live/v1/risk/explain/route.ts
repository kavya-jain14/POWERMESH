import type { RiskExplanation } from "@/contracts-draft/types";
import { BridgeError, errorResponse, explainRisk } from "@/server/coordinator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIERS = new Set(["LOW", "MEDIUM", "HIGH", "BLOCKED"]);

/** Plain-language explanation of a policy decision. Works in both modes; falls back to rule text with no coordinator. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { risk?: RiskExplanation } | null;
    const risk = body?.risk;
    if (!risk || !TIERS.has(risk.tier) || !Array.isArray(risk.facts)) {
      throw new BridgeError(400, "VALIDATION_FAILED", "Send the policy's risk decision.");
    }
    const facts = risk.facts
      .slice(0, 12)
      .filter((f) => typeof f?.code === "string" && typeof f?.label === "string")
      .map((f) => ({ code: f.code, label: f.label.slice(0, 200), effect: f.effect }));
    return Response.json(await explainRisk({ ...risk, facts }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
