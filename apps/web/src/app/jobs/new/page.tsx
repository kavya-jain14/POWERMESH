import type { Metadata } from "next";
import { Forbidden } from "@/components/common/Forbidden";
import { PageHeader } from "@/components/common/PageHeader";
import { Composer } from "@/components/composer/Composer";
import { getRole } from "@/lib/session";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage() {
  const role = await getRole();
  if (role !== "requester") return <Forbidden role={role} needs={["requester"]} />;
  return (
    <>
      <PageHeader
        back={{ href: "/jobs", label: "My jobs" }}
        title="New job"
        description="Pick an approved workload, add inputs and submit. You're asking for one bounded capability — never access to someone's computer."
      />
      <Composer />
    </>
  );
}
