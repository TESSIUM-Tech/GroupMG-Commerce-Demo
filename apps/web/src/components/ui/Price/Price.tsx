import type { ComponentProps } from "react";
import { formatPrice } from "../../../utils/format-price";
import styles from "./Price.module.css";

type PriceProps = ComponentProps<"span"> & {
  amountMinor: number;
  note?: string;
};

/** USD amounts remain integer cents; this component only formats presentation. */
export function Price({
  amountMinor,
  note,
  className = "",
  ...props
}: PriceProps) {
  return (
    <span {...props} className={`${styles.price} ${className}`}>
      <span>{formatPrice(amountMinor)}</span>
      {note && <small className={styles.note}>{note}</small>}
    </span>
  );
}
