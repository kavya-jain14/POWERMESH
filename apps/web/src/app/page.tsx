import { redirect } from "next/navigation";
import { getRole, ROLE_HOME } from "@/lib/session";

export default async function Home() {
  redirect(ROLE_HOME[await getRole()]);
}
