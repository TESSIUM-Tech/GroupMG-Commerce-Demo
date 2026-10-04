"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { readCart, saveCart, type CartItem } from "../../services/cart-storage";
import { products } from "../index/data/products";
import { CartProduct } from "./sections/CartProduct";
import { CartSummary } from "./sections/CartSummary";
import styles from "./CartView.module.css";

export function CartView() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      setItems(
        readCart().filter((item) =>
          products.some((product) => product.sku === item.sku),
        ),
      );
    } catch {
      setError("No se pudo leer el carrito guardado en este navegador.");
    }
    setReady(true);
  }, []);

  function update(next: CartItem[]) {
    try {
      saveCart(next);
      setItems(next);
      setError("");
    } catch {
      setError("No se pudo guardar el cambio. Inténtalo de nuevo.");
    }
  }
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) =>
      sum +
      (products.find((product) => product.sku === item.sku)?.priceMinor ?? 0) *
        item.quantity,
    0,
  );
  const tax = items.reduce(
    (sum, item) =>
      sum +
      Math.round(
        ((products.find((product) => product.sku === item.sku)?.priceMinor ??
          0) *
          item.quantity *
          1500) /
          10000,
      ),
    0,
  );

  return (
    <div className={`container ${styles.page}`}>
      <p className="eyebrow">Tu selección</p>
      <h1>Tu carrito</h1>
      <p className={styles.subtitle}>
        {!ready
          ? "Cargando tu selección…"
          : `${count} ${count === 1 ? "producto listo" : "productos listos"} para acompañarte.`}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {ready && items.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">♧</span>
          <h2>Tu próximo favorito te espera</h2>
          <p>Explora la tienda y agrega los productos que van contigo.</p>
          <Link href="/#tienda">Explorar la tienda ↗</Link>
        </div>
      ) : (
        ready && (
          <div className={styles.layout}>
            <div className={styles.list}>
              {items.map((item) => {
                const product = products.find(
                  (product) => product.sku === item.sku,
                )!;
                return (
                  <CartProduct
                    key={`${item.sku}-${item.color}`}
                    item={item}
                    product={product}
                    onQuantity={(quantity) =>
                      update(
                        items.map((entry) =>
                          entry === item ? { ...entry, quantity } : entry,
                        ),
                      )
                    }
                    onRemove={() =>
                      update(items.filter((entry) => entry !== item))
                    }
                  />
                );
              })}
              <div className={styles.help}>
                <span aria-hidden="true">◇</span>
                <div>
                  <h2>¿Necesitas revisar tu selección?</h2>
                  <p>Encuentra el equipo ideal para ti.</p>
                </div>
                <Link href="/#tienda">Seguir comprando ↗</Link>
              </div>
            </div>
            <CartSummary subtotal={subtotal} tax={tax} />
          </div>
        )
      )}
    </div>
  );
}
