import { handle } from "@/mock/http";
import { networkHealth } from "@/mock/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => networkHealth());
}
