"use client";
import { useId, type ComponentProps } from "react";
import { Field, fieldDescription } from "../Field/Field";
import styles from "./Input.module.css";

type InputProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
  fieldClassName?: string;
};

export function Input({
  id,
  label,
  hint,
  error,
  required,
  className = "",
  fieldClassName,
  "aria-describedby": describedBy,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <Field
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={fieldClassName}
    >
      <input
        {...props}
        id={inputId}
        required={required}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={fieldDescription(inputId, hint, error, describedBy)}
        className={`${styles.input} ${className}`}
      />
    </Field>
  );
}
