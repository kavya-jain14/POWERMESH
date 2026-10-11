import { handle, readJson } from "@/mock/http";
import { listJobs, submitJob } from "@/mock/store";
import type { SubmitJobRequest } from "@/contracts-draft/types";

export const dynamic = "force-dynamic";

/** Q15: GET /v1/jobs?cursor=&limit= → Page<Job>. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  return handle((user) => listJobs(user, { cursor: p.get("cursor"), limit: p.has("limit") ? Number(p.get("limit")) : null }));
}

export async function POST(req: Request) {
  return handle(async (user) => submitJob(await readJson<SubmitJobRequest>(req), user), 201);
}
