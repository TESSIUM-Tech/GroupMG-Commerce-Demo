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
  const base = product.priceMinor * item.quantity;
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
        <small>Disponibilidad por confirmar</small>
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
              disabled={item.quantity >= 99}
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
        {formatPrice(base + Math.round((base * 1500) / 10000))}
        <small>IVA incluido</small>
      </p>
    </article>
  );
}
