import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env for the whole workspace (repo root), the same file the API and Agent read. Next has
// already loaded apps/web's own env by now and caches it, so force a reload from the root.
loadEnvConfig(
  path.resolve(process.cwd(), "../.."),
  process.env.NODE_ENV !== "production",
  undefined,
  true,
);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@powermesh/ui", "@powermesh/contracts"],
  poweredByHeader: false,
  devIndicators: { position: "bottom-right" },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
