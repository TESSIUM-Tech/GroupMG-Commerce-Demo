import { ProductCard } from "../../../components/product/ProductCard/ProductCard";
import { products } from "../data/products";
import styles from "./ProductsSections.module.css";
export function FeaturedProductsSection() {
  return (
    <section
      className={`container ${styles.featured}`}
      id="productos-estrella"
      aria-labelledby="featured-title"
    >
      <p className="eyebrow">Productos estrella</p>
      <div className={styles.heading}>
        <h2 id="featured-title">Los favoritos de nuestra comunidad</h2>
        <a href="#tienda">Ver colección ↗</a>
      </div>
      <div className={styles.grid}>
        {products.slice(0, 3).map((product) => (
          <ProductCard key={product.sku} product={product} />
        ))}
      </div>
    </section>
  );
}
