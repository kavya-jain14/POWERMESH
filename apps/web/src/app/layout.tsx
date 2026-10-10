import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AnnouncerProvider } from "@powermesh/ui";
import { AppShell } from "@/components/shell/AppShell";
import { getRole } from "@/lib/session";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--pm-font-sans-loaded", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--pm-font-mono-loaded", display: "swap" });

export const metadata: Metadata = {
  title: { default: "PowerMesh", template: "%s · PowerMesh" },
  description: "Share spare compute safely — a capability, not a device.",
};

export const viewport: Viewport = {
  themeColor: "#f5f3ee",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AnnouncerProvider>
          <AppShell role={role}>{children}</AppShell>
        </AnnouncerProvider>
      </body>
    </html>
  );
}
