import Link from "next/link";
import { formatPrice } from "../../../utils/format-price";
import styles from "./CartSummary.module.css";
export function CartSummary({
  subtotal,
  tax,
}: {
  subtotal: number;
  tax: number;
}) {
  return (
    <aside className={styles.summary} aria-labelledby="summary-title">
      <h2 id="summary-title">Resumen</h2>
      <dl>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatPrice(subtotal)}</dd>
        </div>
        <div>
          <dt>IVA (15 %)</dt>
          <dd>{formatPrice(tax)}</dd>
        </div>
        <div>
          <dt>Envío</dt>
          <dd>Por calcular</dd>
        </div>
      </dl>
      <div className={styles.total}>
        <div>
          <strong>Total de productos</strong>
          <small>IVA incluido · Envío pendiente</small>
        </div>
        <strong>{formatPrice(subtotal + tax)}</strong>
      </div>
      <Link href="/checkout" className={styles.continue}>
        Continuar con el pago <span aria-hidden="true">→</span>
      </Link>
      <p className={styles.note}>
        Carrito de demostración.
        <br />
        Los pedidos y pagos aún no están habilitados.
      </p>
      <div className={styles.provider}>
        PAYPHONE <span>Integración pendiente</span>
      </div>
    </aside>
  );
}
