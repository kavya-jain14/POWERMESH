import { WORKLOADS } from "@/contracts-draft/workloads";
import { handle } from "@/mock/http";
import { assertCoordinatorUp } from "@/mock/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => {
    assertCoordinatorUp();
    return WORKLOADS;
  });
}
