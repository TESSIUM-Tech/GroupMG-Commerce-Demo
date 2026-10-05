import Image from "next/image";
import { Price } from "../../../components/ui/Price/Price";
import { Button } from "../../../components/ui/Button/Button";
import { products } from "../../index/data/products";
import { calculateOrder, type DemoOrder } from "../../../services/demo-order";
import type { CartItem } from "../../../services/cart-storage";
import styles from "../CheckoutView.module.css";

export function CheckoutSummary({
  items,
  delivery,
}: {
  items: CartItem[];
  delivery: DemoOrder["delivery"];
}) {
  const totals = calculateOrder(items, delivery);
  return (
    <aside className={`${styles.panel} ${styles.summary}`}>
      <h2>Tu selección</h2>
      {items.map((item) => {
        const product = products.find((product) => product.sku === item.sku)!;
        return (
          <div className={styles.product} key={`${item.sku}-${item.color}`}>
            <Image src={product.imageUrl} alt="" width={64} height={64} />
            <div>
              <strong>{product.name}</strong>
              <small>
                {item.quantity} × · {item.color}
              </small>
            </div>
            <Price amountMinor={product.priceMinor * item.quantity} />
          </div>
        );
      })}
      <dl className={styles.totals}>
        <div>
          <dt>Subtotal</dt>
          <dd>
            <Price amountMinor={totals.subtotal} />
          </dd>
        </div>
        <div>
          <dt>IVA productos (15 %)</dt>
          <dd>
            <Price amountMinor={totals.tax} />
          </dd>
        </div>
        <div>
          <dt>Envío demo</dt>
          <dd>
            <Price amountMinor={totals.shipping} />
          </dd>
        </div>
        {totals.shippingTax > 0 && (
          <div>
            <dt>IVA envío (15 %)</dt>
            <dd>
              <Price amountMinor={totals.shippingTax} />
            </dd>
          </div>
        )}
        <div className={styles.total}>
          <dt>Total demo</dt>
          <dd>
            <Price amountMinor={totals.total} />
          </dd>
        </div>
      </dl>
      <Button type="submit" className={styles.submit}>
        Continuar a pago demo →
      </Button>
      <p className={styles.note}>
        No se realizan cobros. PayPhone aún no está conectado.
      </p>
    </aside>
  );
}
