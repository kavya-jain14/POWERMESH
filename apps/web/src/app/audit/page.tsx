import type { Metadata } from "next";
import { AuditView } from "@/components/audit/AuditView";
import { PageHeader } from "@/components/common/PageHeader";
import { getRole } from "@/lib/session";

export const metadata: Metadata = { title: "Policy & Audit" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string; nodeId?: string }>;
}) {
  const role = await getRole();
  const { jobId, nodeId } = await searchParams;
  return (
    <>
      <PageHeader
        title="Policy & Audit"
        description={
          role === "admin"
            ? "Every decision and transition in this community, with who made it and why."
            : role === "provider"
              ? "Everything that happened on your device and why."
              : "Why your jobs were allowed, blocked, stopped or retried."
        }
      />
      <AuditView key={`${jobId}|${nodeId}`} role={role} initial={{ jobId, nodeId }} />
    </>
  );
}
