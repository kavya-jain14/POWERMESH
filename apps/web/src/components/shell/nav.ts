import type { IconName } from "@powermesh/ui";
import type { Role } from "@/contracts-draft/types";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Match nested routes too (e.g. /jobs/123 highlights Jobs). */
  prefix?: boolean;
  exclude?: string[];
}

/** Role-scoped navigation — mirrors the access matrix in docs/design/G1 §2. */
export const NAV: Record<Role, NavItem[]> = {
  requester: [
    { href: "/jobs", label: "My jobs", icon: "list", prefix: true, exclude: ["/jobs/new"] },
    { href: "/jobs/new", label: "New job", icon: "plus" },
    { href: "/control-room", label: "Control Room", icon: "activity" },
    { href: "/audit", label: "Policy & Audit", icon: "file" },
  ],
  provider: [
    { href: "/provider", label: "Provider Console", icon: "node", prefix: true, exclude: ["/provider/policy"] },
    { href: "/provider/policy", label: "Sharing policy", icon: "shield" },
    { href: "/control-room", label: "Control Room", icon: "activity" },
    { href: "/audit", label: "Policy & Audit", icon: "file" },
  ],
  admin: [
    { href: "/control-room", label: "Control Room", icon: "activity" },
    { href: "/jobs", label: "All jobs", icon: "list", prefix: true },
    { href: "/audit", label: "Policy & Audit", icon: "file" },
  ],
};

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.exclude?.some((ex) => pathname === ex || pathname.startsWith(`${ex}/`))) return false;
  if (pathname === item.href) return true;
  return Boolean(item.prefix && pathname.startsWith(`${item.href}/`));
}
