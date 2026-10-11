import { errorResponse, getCatalogue } from "@/server/coordinator";

export const dynamic = "force-dynamic";

/**
 * The coordinator owns workload IDs, digests and execution limits. The bridge enriches those records
 * with presentation-only copy before returning them to the browser.
 */
export async function GET() {
  try {
    return Response.json(await getCatalogue(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
