import { handle, readJson } from "@/mock/http";
import { devControl, devStatus, MockApiError, type DevAction } from "@/mock/store";

export const dynamic = "force-dynamic";

function guard() {
  if (process.env.NODE_ENV === "production" && process.env.POWERMESH_DEMO_CONTROLS !== "1") {
    throw new MockApiError(404, "NOT_FOUND", "Not found.");
  }
}

export async function GET() {
  return handle(() => {
    guard();
    return devStatus();
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    guard();
    return devControl(await readJson<DevAction>(req));
  });
}
