import { handle } from "@/mock/http";
import { listAudit } from "@/mock/store";

export const dynamic = "force-dynamic";

/** Q15/Q17: GET /v1/audit?jobId=&nodeId=&type=&q=&cursor=&limit= → Page<AuditEvent>. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  return handle((user) =>
    listAudit(
      user,
      { jobId: p.get("jobId") ?? undefined, nodeId: p.get("nodeId") ?? undefined, type: p.get("type") ?? undefined, q: p.get("q") ?? undefined },
      { cursor: p.get("cursor"), limit: p.has("limit") ? Number(p.get("limit")) : null },
    ),
  );
}
