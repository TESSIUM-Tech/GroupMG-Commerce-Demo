import type { ComponentProps } from "react";
import styles from "./Button.module.css";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  type = "button",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${styles.button} ${styles[variant]} ${className}`}
    >
      {loading && <span aria-hidden="true">◌</span>}
      {children}
    </button>
  );
}
