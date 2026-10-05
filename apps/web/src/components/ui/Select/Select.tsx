"use client";
import { useId, type ComponentProps } from "react";
import { Field, fieldDescription } from "../Field/Field";
import styles from "./Select.module.css";

type SelectProps = ComponentProps<"select"> & {
  label: string;
  hint?: string;
  error?: string;
  fieldClassName?: string;
};

export function Select({
  id,
  label,
  hint,
  error,
  required,
  children,
  className = "",
  fieldClassName,
  "aria-describedby": describedBy,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <Field
      id={selectId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={fieldClassName}
    >
      <select
        {...props}
        id={selectId}
        required={required}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={fieldDescription(selectId, hint, error, describedBy)}
        className={`${styles.select} ${className}`}
      >
        {children}
      </select>
    </Field>
  );
}
