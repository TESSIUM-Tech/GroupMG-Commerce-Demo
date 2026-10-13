"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  readCart,
  saveCart,
  removeCartItem,
  type CartItem,
} from "../../services/cart-storage";
import { fetchCatalogProducts } from "../../services/catalog-api";
import { products as fallbackProducts } from "../index/data/products";
import type { Product } from "../../types/product";
import { CartProduct } from "./sections/CartProduct";
import { CartSummary } from "./sections/CartSummary";
import { Alert } from "../../components/ui/Alert/Alert";
import { Button } from "../../components/ui/Button/Button";
import { StatePanel } from "../../components/ui/StatePanel/StatePanel";
import { formatPrice } from "../../utils/format-price";
import styles from "./CartView.module.css";

interface InventoryNotice {
  id: string;
  sku: string;
  type: "out_of_stock" | "exceeds_stock" | "price_changed" | "unavailable";
  message: string;
}

export function CartView() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [catalogMap, setCatalogMap] = useState<Map<string, Product>>(new Map());
  const [ready, setReady] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [revalidateError, setRevalidateError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [, startTransition] = useTransition();

  // 1. Cargar el carrito local inmediatamente al montar
  useEffect(() => {
    try {
      const stored = readCart();
      setItems(stored);
    } catch {
      setItems([]);
    }
  }, [attempt]);

  // 2. Revalidar disponibilidad y precios contra la API
  useEffect(() => {
    let cancelled = false;
    setRevalidating(true);
    setRevalidateError("");

    fetchCatalogProducts({ limit: 100 })
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, Product>();
        for (const prod of res.items) {
          map.set(prod.sku, prod);
        }
        setCatalogMap(map);
        setReady(true);
        setRevalidating(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Fallback a productos estáticos para no bloquear la vista si la API está momentáneamente offline,
        // pero avisando explícitamente al usuario sin sustitución silenciosa.
        const map = new Map<string, Product>();
        for (const prod of fallbackProducts) {
          map.set(prod.sku, prod);
        }
        setCatalogMap(map);
        const errMsg =
          err instanceof Error
            ? err.message
            : "No se pudo conectar con el catálogo";
        setRevalidateError(
          `No se pudo revalidar disponibilidad y precios en vivo con el servidor (${errMsg}). Mostrando datos almacenados localmente.`,
        );
        setReady(true);
        setRevalidating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Función para resolver el producto (API prioritario, luego fallback)
  function resolveProduct(sku: string): Product {
    const fromCatalog = catalogMap.get(sku);
    if (fromCatalog) return fromCatalog;

    const fromFallback = fallbackProducts.find((p) => p.sku === sku);
    if (fromFallback) return fromFallback;

    // Producto genérico si no se encuentra en ninguna fuente
    return {
      sku,
      name: `Producto (${sku})`,
      category: "accesorios",
      priceMinor: 0,
      imageUrl: "/images/phone-front.svg",
      inStock: false,
      availableQuantity: 0,
    };
  }

  // Comprobar avisos de disponibilidad o cambios de precio al revalidar
  const notices: InventoryNotice[] = [];
  const skuTotalQuantities = new Map<string, number>();
  for (const item of items) {
    skuTotalQuantities.set(
      item.sku,
      (skuTotalQuantities.get(item.sku) ?? 0) + item.quantity,
    );
  }

  for (const item of items) {
    const product = catalogMap.get(item.sku);
    if (!product && ready && catalogMap.size > 0 && !revalidateError) {
      notices.push({
        id: `unavail-${item.sku}`,
        sku: item.sku,
        type: "unavailable",
        message: `El producto «${item.sku}» ya no está disponible en la tienda.`,
      });
      continue;
    }

    if (product) {
      const isOutOfStock =
        product.inStock === false ||
        (product.availableQuantity !== undefined &&
          product.availableQuantity === 0);
      const available = product.availableQuantity ?? product.stock;
      const totalSku = skuTotalQuantities.get(item.sku) ?? item.quantity;

      if (isOutOfStock) {
        if (
          !notices.some((n) => n.sku === item.sku && n.type === "out_of_stock")
        ) {
          notices.push({
            id: `oos-${item.sku}`,
            sku: item.sku,
            type: "out_of_stock",
            message: `El producto «${product.name}» está agotado.`,
          });
        }
      } else if (available !== undefined && totalSku > available) {
        if (
          !notices.some((n) => n.sku === item.sku && n.type === "exceeds_stock")
        ) {
          notices.push({
            id: `exceed-${item.sku}`,
            sku: item.sku,
            type: "exceeds_stock",
            message: `Solo quedan ${available} unidades de «${product.name}» (tienes ${totalSku} en el carrito).`,
          });
        }
      }

      if (
        item.priceMinor !== undefined &&
        item.priceMinor !== product.priceMinor
      ) {
        notices.push({
          id: `price-${item.sku}-${item.color}`,
          sku: item.sku,
          type: "price_changed",
          message: `El precio de «${product.name}» cambió de ${formatPrice(item.priceMinor)} a ${formatPrice(product.priceMinor)}.`,
        });
      }
    }
  }

  // Modificar cantidad (1..99 y hasta límite de stock)
  function handleQuantity(item: CartItem, nextQuantity: number) {
    const product = resolveProduct(item.sku);
    const available = product.availableQuantity ?? product.stock ?? 99;
    const bounded = Math.min(99, Math.max(1, nextQuantity));
    const finalQuantity = Math.min(bounded, available > 0 ? available : 1);

    const nextItems = items.map((entry) =>
      entry.sku === item.sku && entry.color === item.color
        ? { ...entry, quantity: finalQuantity }
        : entry,
    );

    saveCart(nextItems);
    setItems(nextItems);
  }

  // Eliminar producto del carrito
  function handleRemove(item: CartItem) {
    removeCartItem(item.sku, item.color);
    const nextItems = items.filter(
      (entry) => !(entry.sku === item.sku && entry.color === item.color),
    );
    setItems(nextItems);
    titleRef.current?.focus();
  }

  // Acción para sincronizar precios detectados en revalidación
  function handleAcceptUpdatedPrices() {
    startTransition(() => {
      const nextItems = items.map((item) => {
        const product = catalogMap.get(item.sku);
        return product ? { ...item, priceMinor: product.priceMinor } : item;
      });
      saveCart(nextItems);
      setItems(nextItems);
    });
  }

  // Cálculos orientativos con precios de catálogo
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  const subtotal = items.reduce((sum, item) => {
    const product = resolveProduct(item.sku);
    const unitPrice = product ? product.priceMinor : (item.priceMinor ?? 0);
    return sum + unitPrice * item.quantity;
  }, 0);

  const tax = items.reduce((sum, item) => {
    const product = resolveProduct(item.sku);
    const unitPrice = product ? product.priceMinor : (item.priceMinor ?? 0);
    const rateBps = product?.taxRateBps ?? 1500;
    return sum + Math.round((unitPrice * item.quantity * rateBps) / 10000);
  }, 0);

  const hasBlockingIssues = notices.some(
    (n) =>
      n.type === "out_of_stock" ||
      n.type === "exceeds_stock" ||
      n.type === "unavailable",
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

      {revalidateError && (
        <Alert
          variant="warning"
          title="Aviso de conexión"
          action={
            <Button onClick={() => setAttempt((val) => val + 1)}>
              Reintentar revalidación
            </Button>
          }
        >
          {revalidateError}
        </Alert>
      )}

      {notices.length > 0 && (
        <Alert
          variant="warning"
          title="Actualización de disponibilidad o precios"
          action={
            notices.some((n) => n.type === "price_changed") ? (
              <Button onClick={handleAcceptUpdatedPrices}>
                Aceptar precios actualizados
              </Button>
            ) : undefined
          }
        >
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {notices.map((notice) => (
              <li key={notice.id} style={{ marginTop: "4px" }}>
                {notice.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {!ready && <StatePanel kind="loading" title="Cargando tu carrito" />}

      {ready && items.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">♧</span>
          <h2>Tu próximo favorito te espera</h2>
          <p>Explora el catálogo y agrega los productos que van contigo.</p>
          <Link href="/catalogo">Explorar el catálogo ↗</Link>
        </div>
      ) : (
        ready && (
          <div className={styles.layout}>
            <div className={styles.list}>
              {items.map((item) => {
                const product = resolveProduct(item.sku);
                return (
                  <CartProduct
                    key={`${item.sku}-${item.color}`}
                    item={item}
                    product={product}
                    onQuantity={(q) => handleQuantity(item, q)}
                    onRemove={() => handleRemove(item)}
                  />
                );
              })}
              <div className={styles.help}>
                <span aria-hidden="true">◇</span>
                <div>
                  <h2>¿Quieres seguir explorando?</h2>
                  <p>Descubre más equipos y accesorios en nuestro catálogo.</p>
                </div>
                <Link href="/catalogo">Seguir comprando ↗</Link>
              </div>
            </div>
            <CartSummary
              subtotal={subtotal}
              tax={tax}
              disabled={hasBlockingIssues || items.length === 0}
            />
          </div>
        )
      )}
    </div>
  );
}
