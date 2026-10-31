import Link from "next/link";
import { formatPrice } from "../../../utils/format-price";
import styles from "./CartSummary.module.css";

export function CartSummary({
  subtotal,
  tax,
  disabled = false,
}: {
  subtotal: number;
  tax: number;
  disabled?: boolean;
}) {
  return (
    <aside className={styles.summary} aria-labelledby="summary-title">
      <h2 id="summary-title">Resumen orientativo</h2>
      <dl>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatPrice(subtotal)}</dd>
        </div>
        <div>
          <dt>IVA estimado</dt>
          <dd>{formatPrice(tax)}</dd>
        </div>
        <div>
          <dt>Envío</dt>
          <dd>Por calcular</dd>
        </div>
      </dl>
      <div className={styles.total}>
        <div>
          <strong>Total orientativo</strong>
          <small>IVA incluido · Envío pendiente</small>
        </div>
        <strong>{formatPrice(subtotal + tax)}</strong>
      </div>
      {disabled ? (
        <span
          className={styles.continue}
          style={{
            opacity: 0.6,
            cursor: "not-allowed",
            pointerEvents: "none",
          }}
          aria-disabled="true"
        >
          Ajusta el carrito para continuar
        </span>
      ) : (
        <Link href="/checkout" className={styles.continue}>
          Continuar con el pago <span aria-hidden="true">→</span>
        </Link>
      )}
      <p className={styles.note}>
        Importes calculados para orientación del cliente.
        <br />
        El servidor recalcula los importes oficiales durante el checkout; el
        total del navegador no autoriza cobros.
      </p>
      <div className={styles.provider}>
        PAYPHONE <span>Integración de pruebas</span>
      </div>
    </aside>
  );
}
