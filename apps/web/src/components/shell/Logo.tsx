/** PowerMesh mark: three linked nodes, one lit (a shared capability, not a whole device). */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
        <path d="M6 7 L19 7 L13 19 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="6" cy="7" r="3.2" fill="var(--pm-paper)" stroke="currentColor" strokeWidth="2" />
        <circle cx="19" cy="7" r="3.2" fill="var(--pm-paper)" stroke="currentColor" strokeWidth="2" />
        <circle cx="13" cy="19" r="4.2" fill="var(--pm-accent)" stroke="currentColor" strokeWidth="2" />
      </svg>
      {compact ? null : (
        <span style={{ fontWeight: 700, letterSpacing: "0.14em", fontSize: 14 }}>POWERMESH</span>
      )}
    </span>
  );
}
