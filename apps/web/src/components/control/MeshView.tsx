import type { ProviderNode } from "@/contracts-draft/types";
import styles from "./Control.module.css";

/**
 * Lightweight node visual: coordinator in the centre, providers around it, every link drawn from
 * the provider side (agents dial out). Decorative summary only — the table next to it is the
 * accessible source of truth, so this is aria-hidden.
 */
export function MeshView({ nodes }: { nodes: ProviderNode[] }) {
  const w = 320;
  const h = 172;
  const cx = w / 2;
  const cy = 88;
  const r = 52;
  const placed = nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    return { n, x: cx + Math.cos(a) * r * 2, y: cy + Math.sin(a) * r };
  });

  return (
    <svg className={styles.mesh} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      {placed.map(({ n, x, y }) => (
        <line
          key={`l-${n.id}`}
          x1={x}
          y1={y}
          x2={cx}
          y2={cy}
          className={
            n.status === "offline"
              ? styles.linkOff
              : n.status === "busy"
                ? styles.linkBusy
                : styles.link
          }
        />
      ))}
      <rect x={cx - 34} y={cy - 13} width={68} height={26} rx={6} className={styles.coord} />
      <text x={cx} y={cy + 4} textAnchor="middle" className={styles.coordText}>
        coordinator
      </text>
      {placed.map(({ n, x, y }) => (
        <g key={n.id}>
          <circle cx={x} cy={y} r={11} className={styles[`node-${n.status}`]} />
          {/* Label on the outer side of the node so it never sits on its own link. */}
          <text x={x} y={y < cy ? y - 17 : y + 25} textAnchor="middle" className={styles.nodeText}>
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
