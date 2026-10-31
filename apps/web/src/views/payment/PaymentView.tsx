"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  readDemoOrder,
  saveDemoOrder,
  clearDemoOrder,
  type DemoOrder,
  type OrderStatus,
} from "../../services/demo-order";
import { clearCart } from "../../services/cart-storage";
import { Button } from "../../components/ui/Button/Button";
import { Alert } from "../../components/ui/Alert/Alert";
import { PaymentSummary } from "./sections/PaymentSummary";
import styles from "./PaymentView.module.css";
import { StatePanel } from "../../components/ui/StatePanel/StatePanel";

// ---------------------------------------------------------------------------
// Status metadata — simulates what the backend would return
// ---------------------------------------------------------------------------
type StatusMeta = {
  icon: string;
  eyebrow: string;
  heading: string;
  body: string;
  alertVariant: "info" | "success" | "error" | "warning";
  alertTitle: string;
  alertBody: string;
};

const STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending: {
    icon: "◷",
    eyebrow: "Tu selección está lista",
    heading: "Pago pendiente",
    body: "Estamos listos para el siguiente paso. En una compra real, aquí esperarías la verificación del proveedor sandbox.",
    alertVariant: "info",
    alertTitle: "Estado simulado — pendiente",
    alertBody:
      "No se ha procesado ningún pago, reservado inventario ni enviado una venta al ERP.",
  },
  confirmed: {
    icon: "✓",
    eyebrow: "Gracias por elegirnos",
    heading: "¡Selección confirmada!",
    body: "Completaste el recorrido de compra de demostración. Tu selección está resumida a continuación.",
    alertVariant: "success",
    alertTitle: "Confirmación simulada",
    alertBody:
      "No se ha procesado ningún pago, reservado inventario ni enviado una venta al ERP.",
  },
  rejected: {
    icon: "✕",
    eyebrow: "Algo salió mal",
    heading: "Pago rechazado",
    body: "El proveedor sandbox rechazó el intento de pago. Puedes intentarlo nuevamente o volver al checkout para revisar tu pedido.",
    alertVariant: "error",
    alertTitle: "Estado simulado — rechazado",
    alertBody:
      "En producción el proveedor devolvería un código de error. Tu carrito se conserva para que puedas reintentar.",
  },
  cancelled: {
    icon: "○",
    eyebrow: "Pago cancelado",
    heading: "Cancelaste el pago",
    body: "Cancelaste el proceso de pago. Tu carrito permanece intacto para que puedas continuar cuando quieras.",
    alertVariant: "warning",
    alertTitle: "Estado simulado — cancelado",
    alertBody:
      "El pedido no se procesó. Puedes retomar la compra o explorar el catálogo.",
  },
};

// ---------------------------------------------------------------------------
// PaymentView
// ---------------------------------------------------------------------------
export function PaymentView({ stage }: { stage: OrderStatus }) {
  const router = useRouter();
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Simulate querying the backend for the current order status by reading
  // sessionStorage (the demo's authoritative state store).
  useEffect(() => {
    try {
      setError("");
      setLoadFailed(false);
      const loaded = readDemoOrder();
      setOrder(loaded);
    } catch {
      setLoadFailed(true);
      setError(
        "No se pudo recuperar la demostración. Regresa al checkout para empezar de nuevo.",
      );
    }
    setReady(true);
  }, [attempt]);

  /** Simulate sandbox approval: update status → confirmed, clear cart. */
  function confirmOrder() {
    if (!order || confirming) return;
    setConfirming(true);
    try {
      const updated: DemoOrder = { ...order, status: "confirmed" };
      saveDemoOrder(updated);
      // Clear cart only when payment is confirmed (criterion 5).
      clearCart();
      router.push("/confirmacion");
    } catch {
      setConfirming(false);
      setError(
        "No se pudo guardar la confirmación. Puedes volver a intentarlo.",
      );
    }
  }

  /** Simulate sandbox rejection: update status → rejected, preserve cart. */
  function rejectOrder() {
    if (!order) return;
    try {
      saveDemoOrder({ ...order, status: "rejected" });
      router.push("/pago-rechazado");
    } catch {
      setError("No se pudo simular el rechazo. Inténtalo de nuevo.");
    }
  }

  /** Simulate user cancellation: update status → cancelled, preserve cart. */
  function cancelOrder() {
    if (!order) return;
    try {
      saveDemoOrder({ ...order, status: "cancelled" });
      router.push("/pago-cancelado");
    } catch {
      setError("No se pudo simular la cancelación. Inténtalo de nuevo.");
    }
  }

  // A redirect to /confirmacion does NOT prove payment — we read the stored
  // status and only render the stage if it matches the current order status.
  const statusMatches = order?.status === stage;
  const meta = STATUS_META[stage];

  return (
    <div className={`container ${styles.page}`}>
      {error && (
        <Alert
          variant="error"
          action={
            <>
              <Button
                onClick={() =>
                  loadFailed ? setAttempt((v) => v + 1) : confirmOrder()
                }
              >
                Reintentar
              </Button>
              <Link href="/checkout">Volver al checkout</Link>
            </>
          }
        >
          {error}
        </Alert>
      )}

      {!ready ? (
        <StatePanel kind="loading" title="Consultando estado del pedido" />
      ) : loadFailed ? null : !order || !statusMatches ? (
        // Status mismatch — guide the user to the correct state page
        <div className={styles.card}>
          <h1>
            {!order
              ? "No hay un pedido activo"
              : order.status === "confirmed"
                ? "Tu demostración ya está confirmada"
                : order.status === "rejected"
                  ? "El pago fue rechazado"
                  : order.status === "cancelled"
                    ? "El pago fue cancelado"
                    : "Consulta el estado de tu pedido"}
          </h1>
          <p>
            {!order
              ? "Primero completa el checkout de demostración."
              : "Consulta el estado actual de tu selección."}
          </p>
          <Link
            href={
              !order
                ? "/checkout"
                : order.status === "confirmed"
                  ? "/confirmacion"
                  : order.status === "rejected"
                    ? "/pago-rechazado"
                    : order.status === "cancelled"
                      ? "/pago-cancelado"
                      : "/pago-pendiente"
            }
          >
            Continuar →
          </Link>
        </div>
      ) : (
        <>
          <p className="eyebrow">{meta.eyebrow}</p>
          <div className={styles.layout}>
            <section className={styles.card}>
              <span className={styles.icon} aria-hidden="true">
                {meta.icon}
              </span>
              <h1>{meta.heading}</h1>
              <p>{meta.body}</p>
              <Alert variant={meta.alertVariant} title={meta.alertTitle}>
                {meta.alertBody}
              </Alert>

              {/* Actions per status */}
              {stage === "pending" && (
                <div className={styles.actions}>
                  <Button onClick={confirmOrder} disabled={confirming}>
                    {confirming ? "Procesando…" : "Simular aprobación →"}
                  </Button>
                  <Button onClick={rejectOrder} variant="secondary">
                    Simular rechazo
                  </Button>
                  <Button onClick={cancelOrder} variant="secondary">
                    Simular cancelación
                  </Button>
                </div>
              )}

              {stage === "confirmed" && (
                <div className={styles.actions}>
                  <Link className={styles.primary} href="/catalogo">
                    Seguir explorando ↗
                  </Link>
                </div>
              )}

              {(stage === "rejected" || stage === "cancelled") && (
                <div className={styles.actions}>
                  <Link className={styles.primary} href="/checkout">
                    Reintentar compra →
                  </Link>
                  <Link href="/carrito">Ver mi carrito</Link>
                </div>
              )}

              <p className={styles.note}>
                {stage === "pending" &&
                  "No cierres esta pestaña si quieres conservar el estado demo de la sesión."}
                {stage === "confirmed" &&
                  "Comprobante de demostración, sin validez fiscal. El carrito fue vaciado al confirmar."}
                {stage === "rejected" &&
                  "Tu carrito se conserva. Puedes reintentar cuando quieras."}
                {stage === "cancelled" &&
                  "Tu carrito permanece intacto. Retoma la compra cuando lo desees."}
              </p>
            </section>
            <PaymentSummary order={order} />
          </div>
        </>
      )}
    </div>
  );
}
