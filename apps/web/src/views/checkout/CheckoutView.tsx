"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readCart, type CartItem } from "../../services/cart-storage";
import {
  calculateOrder,
  saveDemoOrder,
  type DemoOrder,
} from "../../services/demo-order";
import { products } from "../index/data/products";
import { Alert } from "../../components/ui/Alert/Alert";
import { CustomerForm } from "./sections/CustomerForm";
import { DeliveryForm } from "./sections/DeliveryForm";
import { CheckoutSummary } from "./sections/CheckoutSummary";
import styles from "./CheckoutView.module.css";
import { StatePanel } from "../../components/ui/StatePanel/StatePanel";
import { Button } from "../../components/ui/Button/Button";

export function CheckoutView() {
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [delivery, setDelivery] = useState<DemoOrder["delivery"]>("pickup");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
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
      setError(
        "No se pudo recuperar tu carrito. Vuelve al carrito para revisarlo.",
      );
    }
    setReady(true);
  }, [attempt]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!items.length) return;
      const quantities = new Map<string, number>();
      for (const item of items)
        quantities.set(
          item.sku,
          (quantities.get(item.sku) ?? 0) + item.quantity,
        );
      if (
        items.some(
          (item) =>
            (quantities.get(item.sku) ?? 0) >
            (products.find((product) => product.sku === item.sku)?.stock ?? 0),
        )
      ) {
        setError(
          "Hay productos agotados o cantidades superiores al stock demo. Ajusta tu carrito para continuar.",
        );
        return;
      }
      saveDemoOrder({
        id: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        items,
        delivery,
        ...calculateOrder(items, delivery),
        status: "pending",
      });
      // Personal form data stays in memory and is not persisted or transmitted.
      router.push("/pago-pendiente");
    } catch {
      setError(
        "No se pudo iniciar la demostración. Reintenta o vuelve al carrito.",
      );
    }
  }
  return (
    <div className={`container ${styles.page}`}>
      <Link className={styles.back} href="/carrito">
        ← Volver al carrito
      </Link>
      <p className="eyebrow">Un paso más cerca</p>
      <h1>Finaliza tu selección</h1>
      <p className={styles.intro}>
        Datos, entrega y resumen. Todo claro antes de continuar.
      </p>
      <Alert title="Experiencia de demostración">
        Usa datos ficticios. Los precios y la tarifa de envío son ilustrativos;
        no se crea un pedido real.
      </Alert>
      {error && (
        <Alert
          variant="error"
          action={
            <>
              <Button onClick={() => setAttempt((value) => value + 1)}>
                Reintentar lectura
              </Button>
              <Link href="/carrito">Revisar carrito →</Link>
            </>
          }
        >
          {error}
        </Alert>
      )}
      {!ready ? (
        <StatePanel kind="loading" title="Cargando tu selección" />
      ) : loadFailed ? null : !items.length ? (
        <div className={styles.panel}>
          <h2>Tu carrito está vacío</h2>
          <p>Agrega un producto para empezar.</p>
          <Link href="/catalogo">Explorar catálogo →</Link>
        </div>
      ) : (
        <form onSubmit={submit} className={styles.layout}>
          <div className={styles.sections}>
            <CustomerForm />
            <DeliveryForm delivery={delivery} onChange={setDelivery} />
          </div>
          <CheckoutSummary items={items} delivery={delivery} />
        </form>
      )}
    </div>
  );
}
