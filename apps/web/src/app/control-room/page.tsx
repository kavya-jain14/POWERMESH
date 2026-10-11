import type { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { ControlRoom } from "@/components/control/ControlRoom";
import { getRole } from "@/lib/session";

export const metadata: Metadata = { title: "Control Room" };

export default async function ControlRoomPage() {
  const role = await getRole();
  return (
    <>
      <PageHeader
        title="Control Room"
        description={
          role === "admin"
            ? "Network health, capacity and active work across this community pool."
            : "How the community pool is doing right now."
        }
      />
      <ControlRoom role={role} />
    </>
  );
}
