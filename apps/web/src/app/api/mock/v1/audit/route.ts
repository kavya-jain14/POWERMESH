import { handle } from "@/mock/http";
import { listAudit } from "@/mock/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return handle((user) =>
    listAudit(user, {
      jobId: url.searchParams.get("jobId") ?? undefined,
      nodeId: url.searchParams.get("nodeId") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
    }),
  );
}
