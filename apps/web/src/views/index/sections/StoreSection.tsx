"use client";
import { useState } from "react";
import { ProductCard } from "../../../components/product/ProductCard/ProductCard";
import { products } from "../data/products";
import styles from "./ProductsSections.module.css";
import { Select } from "../../../components/ui/Select/Select";
const categories = [
  { value: "todos", label: "Todo" },
  { value: "celulares", label: "Celulares" },
  { value: "audio", label: "Audio" },
  { value: "accesorios", label: "Accesorios" },
];
export function StoreSection() {
  const [category, setCategory] = useState("todos");
  const [sort, setSort] = useState("featured");
  const visibleProducts = products.filter(
    (product) => category === "todos" || product.category === category,
  );
  if (sort === "price-low")
    visibleProducts.sort((a, b) => a.priceMinor - b.priceMinor);
  if (sort === "price-high")
    visibleProducts.sort((a, b) => b.priceMinor - a.priceMinor);
  return (
    <section className={styles.store} id="tienda" aria-labelledby="store-title">
      <div className="container">
        <p className="eyebrow">Tecnología a tu medida</p>
        <div className={styles.heading}>
          <h2 id="store-title">Encuentra el equipo ideal para ti</h2>
          <p>
            Para crear, conectar y disfrutar.
            <br />
            Elige lo que va contigo.
          </p>
        </div>
        <div className={styles.toolbar}>
          <div
            className={styles.filters}
            role="group"
            aria-label="Filtrar por categoría"
          >
            {categories.map((item) => (
              <button
                type="button"
                key={item.value}
                aria-pressed={category === item.value}
                onClick={() => setCategory(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Select
            label="Ordenar por"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="featured">Destacados</option>
            <option value="price-low">Menor precio</option>
            <option value="price-high">Mayor precio</option>
          </Select>
        </div>
        <p className={styles.count} aria-live="polite">
          {visibleProducts.length} productos · Colección demo
        </p>
        <div className={styles.grid}>
          {visibleProducts.map((product) => (
            <ProductCard key={product.sku} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}
