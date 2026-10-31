import type { ComponentProps, ReactNode } from "react";
import styles from "./Alert.module.css";

type AlertProps = ComponentProps<"div"> & {
  variant?: "info" | "success" | "warning" | "error";
  title?: string;
  action?: ReactNode;
};
const symbols = { info: "ⓘ", success: "✓", warning: "!", error: "!" };

export function Alert({
  variant = "info",
  title,
  action,
  className = "",
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role={variant === "error" || variant === "warning" ? "alert" : "status"}
      {...props}
      className={`${styles.alert} ${styles[variant]} ${className}`}
    >
      <span aria-hidden="true" className={styles.icon}>
        {symbols[variant]}
      </span>
      <div className={styles.content}>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
}
