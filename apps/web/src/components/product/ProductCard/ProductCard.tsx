import Image from "next/image";
import Link from "next/link";
import type { Product } from "../../../types/product";
import { formatPrice } from "../../../utils/format-price";
import styles from "./ProductCard.module.css";
export function ProductCard({ product }: { product: Product }) {
  return (
    <article className={styles.card}>
      <Link
        href={`/producto/${product.sku}`}
        aria-label={`Ver ${product.name}`}
        className={styles.link}
      >
        <div className={styles.image}>
          <Image
            src={product.imageUrl}
            alt={product.name}
            width={640}
            height={480}
          />
        </div>
        <div className={styles.content}>
          <span className={styles.category}>{product.category}</span>
          <h3>{product.name}</h3>
          <p className={styles.price}>{formatPrice(product.priceMinor)}</p>
          <p className={styles.description}>{product.description}</p>
          <span className={styles.tax}>Precio base · IVA no incluido</span>
        </div>
      </Link>
    </article>
  );
}
