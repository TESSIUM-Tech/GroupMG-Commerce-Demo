"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { readCart, saveCart, type CartItem } from "../../services/cart-storage";
import { products } from "../index/data/products";
import { CartProduct } from "./sections/CartProduct";
import { CartSummary } from "./sections/CartSummary";
import styles from "./CartView.module.css";
import { Alert } from "../../components/ui/Alert/Alert";
import { Button } from "../../components/ui/Button/Button";
import { StatePanel } from "../../components/ui/StatePanel/StatePanel";

export function CartView() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<CartItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    try {
      setError("");
      setLoadFailed(false);
      setItems(
        readCart().filter((item) =>
          products.some((product) => product.sku === item.sku),
        ),
      );
    } catch {
      setLoadFailed(true);
      setError("No se pudo leer el carrito guardado en este navegador.");
    }
    setReady(true);
  }, [attempt]);

  function update(next: CartItem[], returnFocus = false) {
    try {
      saveCart(next);
      setItems(next);
      setError("");
      setPending(null);
      if (returnFocus) titleRef.current?.focus();
    } catch {
      setPending(next);
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
      <h1 ref={titleRef} tabIndex={-1}>
        Tu carrito
      </h1>
      <p className={styles.subtitle}>
        {!ready
          ? "Cargando tu selección…"
          : `${count} ${count === 1 ? "producto listo" : "productos listos"} para acompañarte.`}
      </p>
      {error && (
        <Alert
          variant="error"
          title="No se pudo actualizar el carrito"
          action={
            <Button
              onClick={() =>
                pending ? update(pending) : setAttempt((value) => value + 1)
              }
            >
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {!ready && <StatePanel kind="loading" title="Cargando tu carrito" />}
      {ready &&
        !loadFailed &&
        items.some((item) => {
          const quantity = items
            .filter((entry) => entry.sku === item.sku)
            .reduce((sum, entry) => sum + entry.quantity, 0);
          return (
            quantity >
            (products.find((product) => product.sku === item.sku)?.stock ?? 0)
          );
        }) && (
          <Alert variant="warning" title="Revisa la disponibilidad">
            Algunas cantidades superan el stock demo. Reduce las unidades o
            elimina los productos agotados antes de continuar.
          </Alert>
        )}
      {ready && !loadFailed && items.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">♧</span>
          <h2>Tu próximo favorito te espera</h2>
          <p>Explora la tienda y agrega los productos que van contigo.</p>
          <Link href="/#tienda">Explorar la tienda ↗</Link>
        </div>
      ) : (
        ready &&
        !loadFailed && (
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
                      update(
                        items.filter((entry) => entry !== item),
                        true,
                      )
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
