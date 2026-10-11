import styles from "./Feedback.module.css";

/** Decorative spinner. Pair with visible text (e.g. "Loading jobs…") or an aria-busy container. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} aria-hidden="true" />
  );
}
