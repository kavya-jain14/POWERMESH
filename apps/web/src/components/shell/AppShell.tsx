"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Select, cx } from "@powermesh/ui";
import type { Role } from "@/contracts-draft/types";
import { IS_LIVE, IS_MOCK, devApi } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/copy";
import { NAV, isActive } from "./nav";
import { Logo } from "./Logo";
import { DemoControls } from "./DemoControls";
import styles from "./AppShell.module.css";

const ROLE_HOME: Record<Role, string> = { requester: "/jobs", provider: "/provider", admin: "/control-room" };

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  // Close the narrow-screen menu on navigation.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const switchRole = async (next: Role) => {
    setSwitching(true);
    try {
      await devApi.setRole(next);
      router.push(ROLE_HOME[next]);
      router.refresh();
    } finally {
      setSwitching(false);
    }
  };

  const nav = (
    <nav aria-label="Main">
      <ul role="list" className={styles.navList}>
        {NAV[role].map((item) => {
          const active = isActive(item, pathname);
          return (
            <li key={item.href}>
              <Link href={item.href} className={cx(styles.navLink, active && styles.navLinkActive)} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const roleSwitch = (id: string) => IS_MOCK ? (
    <div className={styles.roleSwitch}>
      <label htmlFor={id} className={styles.roleLabel}>
        Viewing as <span className={styles.mockTag}>demo</span>
      </label>
      <Select id={id} value={role} disabled={switching} onChange={(e) => void switchRole(e.target.value as Role)}>
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
    </div>
  ) : (
    <p className={styles.roleLabel}>Signed in as {ROLE_LABEL[role]}</p>
  );

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>

      <header className={styles.topbar}>
        <Link href={ROLE_HOME[role]} className={styles.brand} aria-label="PowerMesh home">
          <Logo />
        </Link>
        <button
          ref={menuButton}
          type="button"
          className={styles.menuButton}
          aria-expanded={menuOpen}
          aria-controls="pm-mobile-nav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name={menuOpen ? "x" : "menu"} />
          Menu
        </button>
      </header>

      <div id="pm-mobile-nav" className={cx(styles.drawer, menuOpen && styles.drawerOpen)} hidden={!menuOpen}>
        {nav}
        <div className={styles.sidebarFooter}>
          {roleSwitch("pm-role-drawer")}
          {IS_MOCK ? <DemoControls /> : null}
        </div>
      </div>

      <aside className={styles.sidebar} aria-label="Sidebar">
        <Link href={ROLE_HOME[role]} className={styles.brand} aria-label="PowerMesh home">
          <Logo />
        </Link>
        <p className={styles.tagline}>Share a capability, not a device.</p>
        {nav}
        <div className={styles.sidebarFooter}>
          {roleSwitch("pm-role-sidebar")}
          {IS_MOCK ? <DemoControls /> : null}
        </div>
      </aside>

      <main id="main" className={styles.main} tabIndex={-1}>
        {IS_LIVE ? (
          <p className={styles.mockStrip}>
            <Icon name="info" size={14} />
            Live coordinator for jobs. Provider, offers, network and audit still use mock data — the API has no endpoints for them yet.
          </p>
        ) : IS_MOCK ? (
          <p className={styles.mockStrip}>
            <Icon name="info" size={14} />
            Mock coordinator — draft contracts and fixture data. Not connected to real providers.
          </p>
        ) : null}
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
