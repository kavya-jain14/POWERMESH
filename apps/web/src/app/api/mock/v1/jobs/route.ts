import { handle, readJson } from "@/mock/http";
import { listJobs, submitJob } from "@/mock/store";
import type { SubmitJobRequest } from "@/contracts-draft/types";

export const dynamic = "force-dynamic";

/** ❓ Kavya: a list endpoint isn't in API v0 yet — /jobs needs one. */
export async function GET() {
  return handle((user) => listJobs(user));
}

export async function POST(req: Request) {
  return handle(async (user) => submitJob(await readJson<SubmitJobRequest>(req), user), 201);
}
