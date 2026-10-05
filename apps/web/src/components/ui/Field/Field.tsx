import type { ReactNode } from "react";
import styles from "./Field.module.css";

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function fieldDescription(
  id: string,
  hint?: string,
  error?: string,
  describedBy?: string,
): string | undefined {
  return (
    [describedBy, hint && `${id}-hint`, error && `${id}-error`]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className = "",
}: FieldProps) {
  return (
    <div className={`${styles.field} ${className}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
