import type { Job, Page, SubmitJobRequest } from "@/contracts-draft/types";
import { BridgeError, errorResponse, listJobViews, submitJob } from "@/server/coordinator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

/** Same Page shape as Q15. API v0 has no list endpoint, so this is one page of remembered jobs. */
export async function GET() {
  try {
    const page: Page<Job> = { items: await listJobViews(), nextCursor: null };
    return Response.json(page, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => {
      throw new BridgeError(400, "VALIDATION_FAILED", "Request body must be JSON.");
    })) as SubmitJobRequest;
    return Response.json(await submitJob(body), { status: 201, headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
