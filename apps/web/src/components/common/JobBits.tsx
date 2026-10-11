import { Badge, Icon, RiskBadge, type IconName } from "@powermesh/ui";
import type { JobState, RiskExplanation, RiskFact } from "@/contracts-draft/types";
import { STATE_COPY } from "@/lib/copy";
import styles from "./common.module.css";

export function JobStateBadge({ state, size }: { state: JobState; size?: "md" | "lg" }) {
  const c = STATE_COPY[state];
  return (
    <Badge tone={c.tone} icon={c.icon} size={size}>
      {c.badge}
    </Badge>
  );
}

const effectIcon: Record<RiskFact["effect"], IconName> = { lowers: "check", raises: "alert", blocks: "x" };
const effectLabel: Record<RiskFact["effect"], string> = { lowers: "Lowers risk", raises: "Raises risk", blocks: "Blocks" };

/**
 * Risk tier + every reason behind it, in plain language (master plan §6: show the reason behind
 * every risk tier and blocked decision). Effects are conveyed with text, icon and colour.
 */
export function RiskExplanationView({ risk, heading = "Risk", compact = false }: { risk: RiskExplanation; heading?: string; compact?: boolean }) {
  return (
    <div className={styles.risk}>
      <div className={styles.riskHead}>
        <span className={styles.riskHeading}>{heading}</span>
        <RiskBadge tier={risk.tier} size={compact ? "md" : "lg"} />
      </div>
      <ul role="list" className={styles.riskFacts}>
        {risk.facts.map((f) => (
          <li key={f.code} className={`${styles.riskFact} ${styles[`effect-${f.effect}`]}`}>
            <Icon name={effectIcon[f.effect]} size={14} className={styles.riskFactIcon} />
            <span>
              <span className="pm-visually-hidden">{effectLabel[f.effect]}: </span>
              {f.label}
              {f.detail ? <span className={styles.riskFactDetail}> {f.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {compact ? null : (
        <p className={styles.riskFoot}>
          Deterministic rules, policy {risk.policyVersion}. Not an AI score.
        </p>
      )}
    </div>
  );
}
