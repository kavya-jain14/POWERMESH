import type { Metadata } from "next";
import { Forbidden } from "@/components/common/Forbidden";
import { ProviderConsole } from "@/components/provider/ProviderConsole";
import { getRole } from "@/lib/session";

export const metadata: Metadata = { title: "Provider Console" };

export default async function ProviderPage() {
  const role = await getRole();
  if (role !== "provider") return <Forbidden role={role} needs={["provider"]} />;
  return <ProviderConsole />;
}
