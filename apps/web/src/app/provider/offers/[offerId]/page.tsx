import type { Metadata } from "next";
import { Forbidden } from "@/components/common/Forbidden";
import { ProviderConsole } from "@/components/provider/ProviderConsole";
import { getRole } from "@/lib/session";

export const metadata: Metadata = { title: "Review request" };

/** Approval Sheet: rendered as a modal sheet over the Provider Console, deep-linkable (G1 §3.4). */
export default async function OfferPage({ params }: { params: Promise<{ offerId: string }> }) {
  const role = await getRole();
  if (role !== "provider") return <Forbidden role={role} needs={["provider"]} />;
  const { offerId } = await params;
  return <ProviderConsole offerId={offerId} />;
}
