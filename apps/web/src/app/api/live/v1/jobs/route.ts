import type { SubmitJobRequest } from "@/contracts-draft/types";
import { BridgeError, errorResponse, listJobViews, submitJob } from "@/server/coordinator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    return Response.json(await listJobViews(), { headers: noStore });
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
