import { handle } from "@/mock/http";
import { assertCoordinatorUp } from "@/mock/store";
import { WORKLOADS } from "@/contracts-draft/workloads";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => {
    assertCoordinatorUp();
    return WORKLOADS;
  });
}
