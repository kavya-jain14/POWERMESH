import { cookies } from "next/headers";
import { ROLE_COOKIE } from "@/mock/http";

export const dynamic = "force-dynamic";

/** Mock-only role switch. Real auth + server-side roles are K4 (Kavya). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { role?: string };
  const role = body.role === "provider" || body.role === "admin" ? body.role : "requester";
  const jar = await cookies();
  jar.set(ROLE_COOKIE, role, { httpOnly: true, sameSite: "lax", path: "/" });
  return Response.json({ role });
}
