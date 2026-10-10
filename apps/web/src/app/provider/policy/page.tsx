import type { Metadata } from "next";
import { PolicyEditor } from "@/components/provider/PolicyEditor";
import { PageHeader } from "@/components/common/PageHeader";
import { Forbidden } from "@/components/common/Forbidden";
import { getRole } from "@/lib/session";

export const metadata: Metadata = { title: "Sharing policy" };

export default async function PolicyPage() {
  const role = await getRole();
  if (role !== "provider") return <Forbidden role={role} needs={["provider"]} />;
  return (
    <>
      <PageHeader
        back={{ href: "/provider", label: "Provider Console" }}
        title="Sharing policy"
        description="Decide exactly what this device shares. Requests that don't match every rule are never offered to you."
      />
      <PolicyEditor />
    </>
  );
}
