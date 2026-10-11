import { handle, readJson } from "@/mock/http";
import { type DevAction, devControl, devStatus } from "@/mock/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => devStatus());
}

export async function POST(req: Request) {
  return handle(async () => devControl(await readJson<DevAction>(req)));
}
