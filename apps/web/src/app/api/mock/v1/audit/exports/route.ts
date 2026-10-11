import { currentUser, errorResponse, readJson } from "@/mock/http";
import { assertOfflineDemoEnabled, exportAudit, MockApiError, type AuditFilters } from "@/mock/store";
import type { AuditEvent } from "@/contracts-draft/types";

export const dynamic = "force-dynamic";

const COLUMNS = ["id", "at", "type", "actorRole", "actor", "jobId", "nodeId", "summary", "reason", "correlationId"] as const;

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: AuditEvent[]): string {
  const lines = rows.map((r) => [r.id, r.at, r.type, r.actor.role, r.actor.label, r.jobId, r.nodeId, r.summary, r.reason, r.correlationId].map(csvCell).join(","));
  return [COLUMNS.join(","), ...lines].join("\r\n");
}

/** Q17: POST /v1/audit/exports { format, filters } — complete, authorised and redacted server-side. */
export async function POST(req: Request) {
  try {
    assertOfflineDemoEnabled();
    const body = await readJson<{ format?: unknown; filters?: AuditFilters }>(req);
    if (body.format !== "csv" && body.format !== "json") throw new MockApiError(400, "VALIDATION_FAILED", "format must be csv or json.", { format: "Use csv or json." });
    const f = body.filters ?? {};
    const rows = exportAudit(await currentUser(), { jobId: f.jobId, nodeId: f.nodeId, type: f.type, q: f.q });
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    return new Response(body.format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": body.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="powermesh-audit-${stamp}.${body.format}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
