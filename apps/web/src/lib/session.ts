import { cookies } from "next/headers";
import type { Role } from "@/contracts-draft/types";

/**
 * MOCK session. Real auth and server-side role storage are K4 (Kavya); until then the role comes
 * from a cookie set by the demo role switcher. Pages still gate on role so the route map's access
 * rules (G1 §2) are exercised from day one.
 */
export async function getRole(): Promise<Role> {
  const value = (await cookies()).get("pm_role")?.value;
  return value === "provider" || value === "admin" ? value : "requester";
}

export const ROLE_HOME: Record<Role, string> = {
  requester: "/jobs",
  provider: "/provider",
  admin: "/control-room",
};
