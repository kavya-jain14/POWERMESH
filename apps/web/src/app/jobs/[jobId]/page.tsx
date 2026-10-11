import type { Metadata } from "next";
import { FlightRecorder } from "@/components/recorder/FlightRecorder";
import { getRole } from "@/lib/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  return { title: `Job ${(await params).jobId}` };
}

/** Access is enforced by the API: requesters see their own jobs, providers jobs on their node, admins all. */
export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const role = await getRole();
  return <FlightRecorder key={jobId} jobId={jobId} role={role} />;
}
