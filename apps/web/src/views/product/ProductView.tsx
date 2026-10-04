import Link from "next/link";
import type { Product } from "../../types/product";
import { ProductGallery } from "./sections/ProductGallery";
import { ProductInformation } from "./sections/ProductInformation";
import styles from "./ProductView.module.css";

export function ProductView({ product }: { product: Product }) {
  return (
    <div className={`container ${styles.page}`}>
      <nav className={styles.breadcrumb} aria-label="Ruta de navegación">
        <Link href="/#tienda">Tienda</Link>
        <span aria-hidden="true">›</span>
        <span>{product.category}</span>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{product.name}</span>
      </nav>
      <div className={styles.layout}>
        <ProductGallery product={product} />
        <ProductInformation product={product} />
      </div>
    </div>
  );
}
