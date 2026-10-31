"use client";

import { useSyncExternalStore } from "react";
import { CART_UPDATED_EVENT, readCart } from "../services/cart-storage";

function subscribe(refresh: () => void) {
  window.addEventListener(CART_UPDATED_EVENT, refresh);
  window.addEventListener("storage", refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    window.removeEventListener(CART_UPDATED_EVENT, refresh);
    window.removeEventListener("storage", refresh);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

function getCount() {
  try {
    return readCart().reduce((total, item) => total + item.quantity, 0);
  } catch {
    return 0;
  }
}

export function useCartCount() {
  return useSyncExternalStore(subscribe, getCount, () => 0);
}
