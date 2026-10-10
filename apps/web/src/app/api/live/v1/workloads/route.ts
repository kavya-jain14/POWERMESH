import { CATALOGUE } from "@/server/coordinator";

export const dynamic = "force-dynamic";

/**
 * The coordinator has no workload catalogue endpoint yet, so the signed-catalogue fixture is served
 * from here. Submissions still go through the coordinator's own schema and risk policy.
 */
export async function GET() {
  return Response.json(CATALOGUE, { headers: { "Cache-Control": "no-store" } });
}
