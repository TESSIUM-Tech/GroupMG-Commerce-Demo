"use client";

import Link from "next/link";
import { useCartCount } from "../../../hooks/use-cart-count";
import styles from "./Header.module.css";

export function CartLink() {
  const count = useCartCount();

  return (
    <Link
      href="/carrito"
      className={styles.cart}
      aria-label={`Carrito, ${count} ${count === 1 ? "producto" : "productos"}`}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 3h3l2.4 12h11.8l2-8H6" />
        <circle cx="9" cy="20" r="1.3" />
        <circle cx="18" cy="20" r="1.3" />
      </svg>
      <span>Carrito</span>
      <span className={styles.cartCount} aria-live="polite" aria-atomic="true">
        {count}
      </span>
    </Link>
  );
}
