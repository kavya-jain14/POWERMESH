import { AnnouncerProvider } from "@powermesh/ui";
import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { getRole } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PowerMesh", template: "%s · PowerMesh" },
  description: "Share spare compute safely — a capability, not a device.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole();
  return (
    <html lang="en">
      <body>
        <AnnouncerProvider>
          <AppShell role={role}>{children}</AppShell>
        </AnnouncerProvider>
      </body>
    </html>
  );
}
