import { buttonClassName, Icon } from "@powermesh/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/common/Forbidden";
import { PageHeader } from "@/components/common/PageHeader";
import { JobsList } from "@/components/jobs/JobsList";
import { getRole } from "@/lib/session";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage() {
  const role = await getRole();
  if (role === "provider") return <Forbidden role={role} needs={["requester", "admin"]} />;
  return (
    <>
      <PageHeader
        title={role === "admin" ? "All jobs" : "My jobs"}
        description={
          role === "admin"
            ? "Every job in this community pool."
            : "Jobs you've submitted. Open one to follow it live."
        }
        actions={
          role === "requester" ? (
            <Link href="/jobs/new" className={buttonClassName("primary")}>
              <Icon name="plus" />
              New job
            </Link>
          ) : null
        }
      />
      <JobsList role={role} />
    </>
  );
}
