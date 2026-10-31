import type { ReactNode } from "react";
import styles from "./StatePanel.module.css";

interface StatePanelProps {
  kind: "loading" | "empty" | "error" | "unavailable";
  title: string;
  description?: string;
  action?: ReactNode;
}
const icons = { loading: "◌", empty: "◇", error: "!", unavailable: "—" };

export function StatePanel({
  kind,
  title,
  description,
  action,
}: StatePanelProps) {
  return (
    <div
      className={styles.panel}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" || undefined}
    >
      <span
        className={`${styles.icon} ${kind === "loading" ? styles.loading : ""}`}
        aria-hidden="true"
      >
        {icons[kind]}
      </span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {kind === "loading" && (
        <div className={styles.skeleton} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {action && <div className={styles.actions}>{action}</div>}
    </div>
  );
}
