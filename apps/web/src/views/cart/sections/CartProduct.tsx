import Image from "next/image";
import Link from "next/link";
import type { Product } from "../../../types/product";
import type { CartItem } from "../../../services/cart-storage";
import { formatPrice } from "../../../utils/format-price";
import styles from "./CartProduct.module.css";

export function CartProduct({
  item,
  product,
  onQuantity,
  onRemove,
}: {
  item: CartItem;
  product: Product;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const isOutOfStock =
    product.inStock === false ||
    (product.availableQuantity !== undefined
      ? product.availableQuantity === 0
      : product.stock === 0);
  const availableStock = product.availableQuantity ?? product.stock;
  const exceedsStock =
    availableStock !== undefined && item.quantity > availableStock;
  const priceChanged =
    item.priceMinor !== undefined && item.priceMinor !== product.priceMinor;

  const taxRateBps = product.taxRateBps ?? 1500;
  const base = product.priceMinor * item.quantity;
  const lineTotal = base + Math.round((base * taxRateBps) / 10000);

  return (
    <article className={styles.card}>
      <Link href={`/producto/${product.sku}`} className={styles.image}>
        <Image
          src={product.imageUrl}
          alt={product.name}
          width={180}
          height={180}
        />
      </Link>
      <div className={styles.info}>
        <span className={styles.badge}>COLECCIÓN DEMO</span>
        <h2>
          <Link href={`/producto/${product.sku}`}>{product.name}</Link>
        </h2>
        <p>Color de presentación: {item.color}</p>

        {isOutOfStock ? (
          <small style={{ color: "#c92a2a", fontWeight: 600 }}>
            ● Agotado en la tienda
          </small>
        ) : exceedsStock ? (
          <small style={{ color: "#c92a2a", fontWeight: 600 }}>
            ● Solo {availableStock} disponibles (reduce la cantidad)
          </small>
        ) : availableStock !== undefined ? (
          <small>● {availableStock} disponibles</small>
        ) : (
          <small>Disponibilidad por confirmar</small>
        )}

        {priceChanged && (
          <small style={{ color: "#d97706", display: "block" }}>
            Precio actualizado: antes {formatPrice(item.priceMinor!)}
          </small>
        )}

        <div className={styles.actions}>
          <div
            className={styles.quantity}
            role="group"
            aria-label={`Cantidad de ${product.name}`}
          >
            <button
              type="button"
              aria-label={`Reducir cantidad de ${product.name}`}
              disabled={item.quantity <= 1}
              onClick={() => onQuantity(item.quantity - 1)}
            >
              −
            </button>
            <span aria-live="polite">{item.quantity}</span>
            <button
              type="button"
              aria-label={`Aumentar cantidad de ${product.name}`}
              disabled={
                item.quantity >= 99 ||
                (availableStock !== undefined &&
                  item.quantity >= availableStock)
              }
              onClick={() => onQuantity(item.quantity + 1)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className={styles.remove}
            onClick={onRemove}
            aria-label={`Eliminar ${product.name}`}
          >
            Eliminar
          </button>
        </div>
      </div>
      <p className={styles.price}>
        {formatPrice(lineTotal)}
        <small>IVA ({Math.round(taxRateBps / 100)} %) incluido</small>
      </p>
    </article>
  );
}
