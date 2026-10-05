"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  readDemoOrder,
  saveDemoOrder,
  type DemoOrder,
} from "../../services/demo-order";
import { Button } from "../../components/ui/Button/Button";
import { Alert } from "../../components/ui/Alert/Alert";
import { PaymentSummary } from "./sections/PaymentSummary";
import styles from "./PaymentView.module.css";
import { StatePanel } from "../../components/ui/StatePanel/StatePanel";

export function PaymentView({ stage }: { stage: "pending" | "confirmed" }) {
  const router = useRouter();
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    try {
      setError("");
      setLoadFailed(false);
      setOrder(readDemoOrder());
    } catch {
      setLoadFailed(true);
      setError(
        "No se pudo recuperar la demostración. Regresa al checkout para empezar de nuevo.",
      );
    }
    setReady(true);
  }, [attempt]);
  function confirm() {
    if (!order) return;
    try {
      saveDemoOrder({ ...order, status: "confirmed" });
      router.push("/confirmacion");
    } catch {
      setError(
        "No se pudo guardar la confirmación. Puedes volver a intentarlo.",
      );
    }
  }
  const matches = order?.status === stage;
  return (
    <div className={`container ${styles.page}`}>
      {error && (
        <Alert
          variant="error"
          action={
            <>
              <Button
                onClick={() =>
                  loadFailed ? setAttempt((value) => value + 1) : confirm()
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
        <StatePanel kind="loading" title="Recuperando tu selección" />
      ) : loadFailed ? null : !order || !matches ? (
        <div className={styles.card}>
          <h1>
            {order?.status === "confirmed"
              ? "Tu demostración ya está confirmada"
              : "No hay una confirmación disponible"}
          </h1>
          <p>
            {!order
              ? "Primero completa el checkout de demostración."
              : "Consulta el estado actual de tu selección."}
          </p>
          <Link
            href={
              order?.status === "confirmed"
                ? "/confirmacion"
                : order
                  ? "/pago-pendiente"
                  : "/checkout"
            }
          >
            Continuar →
          </Link>
        </div>
      ) : (
        <>
          <p className="eyebrow">
            {stage === "pending"
              ? "Tu selección está lista"
              : "Gracias por elegirnos"}
          </p>
          <div className={styles.layout}>
            <section className={styles.card}>
              <span className={styles.icon} aria-hidden="true">
                {stage === "pending" ? "◷" : "✓"}
              </span>
              <h1>
                {stage === "pending"
                  ? "Pago pendiente"
                  : "¡Selección confirmada!"}
              </h1>
              <p>
                {stage === "pending"
                  ? "Estamos listos para el siguiente paso. En una compra real, aquí esperarías la verificación del proveedor."
                  : "Completaste el recorrido de compra de demostración. Tu selección está resumida a continuación."}
              </p>
              <Alert
                variant={stage === "pending" ? "info" : "success"}
                title={
                  stage === "pending"
                    ? "Estado simulado"
                    : "Confirmación simulada"
                }
              >
                No se ha procesado ningún pago, reservado inventario ni enviado
                una venta al ERP.
              </Alert>
              {stage === "pending" ? (
                <div className={styles.actions}>
                  <Button onClick={confirm}>Simular aprobación →</Button>
                  <Link href="/checkout">Volver y revisar datos</Link>
                </div>
              ) : (
                <div className={styles.actions}>
                  <Link className={styles.primary} href="/catalogo">
                    Seguir explorando ↗
                  </Link>
                  <Link href="/carrito">Ver mi carrito</Link>
                </div>
              )}
              <p className={styles.note}>
                {stage === "pending"
                  ? "No cierres esta pestaña si quieres conservar el estado demo de la sesión."
                  : "Comprobante de demostración, sin validez fiscal. El carrito se conserva para seguir probando."}
              </p>
            </section>
            <PaymentSummary order={order} />
          </div>
        </>
      )}
    </div>
  );
}
