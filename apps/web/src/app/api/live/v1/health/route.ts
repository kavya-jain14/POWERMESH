import { COORDINATOR_URL, coordinatorHealth } from "@/server/coordinator";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await coordinatorHealth();
  return Response.json(
    { ...health, url: COORDINATOR_URL },
    { headers: { "Cache-Control": "no-store" } },
  );
}
