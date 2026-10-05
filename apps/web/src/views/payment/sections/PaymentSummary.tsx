import { Price } from "../../../components/ui/Price/Price";
import { products } from "../../index/data/products";
import type { DemoOrder } from "../../../services/demo-order";
import styles from "../PaymentView.module.css";

export function PaymentSummary({ order }: { order: DemoOrder }) {
  return (
    <aside className={styles.card}>
      <h2>Resumen de tu selección</h2>
      <p className={styles.reference}>Referencia demo: {order.id}</p>
      <div className={styles.items}>
        {order.items.map((item) => (
          <div key={`${item.sku}-${item.color}`}>
            <strong>
              {products.find((product) => product.sku === item.sku)?.name ??
                item.sku}
            </strong>
            <small>
              {item.quantity} unidades · {item.color}
            </small>
          </div>
        ))}
      </div>
      <dl>
        <div>
          <dt>Subtotal</dt>
          <dd>
            <Price amountMinor={order.subtotal} />
          </dd>
        </div>
        <div>
          <dt>IVA productos</dt>
          <dd>
            <Price amountMinor={order.tax} />
          </dd>
        </div>
        <div>
          <dt>Envío con IVA</dt>
          <dd>
            <Price amountMinor={order.shipping + order.shippingTax} />
          </dd>
        </div>
        <div className={styles.total}>
          <dt>Total demo</dt>
          <dd>
            <Price amountMinor={order.total} />
          </dd>
        </div>
      </dl>
      <p className={styles.note}>
        {order.delivery === "pickup"
          ? "Retiro en local"
          : "Entrega a domicilio"}{" "}
        · Sin envío real
      </p>
    </aside>
  );
}
