"use client";
import { useRef, useState } from "react";
import { products } from "../index/data/products";
import { Input } from "../../components/ui/Input/Input";
import { Select } from "../../components/ui/Select/Select";
import { Button } from "../../components/ui/Button/Button";
import { ProductCard } from "../../components/product/ProductCard/ProductCard";
import styles from "./CatalogView.module.css";
import { StatePanel } from "../../components/ui/StatePanel/StatePanel";

export function CatalogView() {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("todos");
  const [sort, setSort] = useState("featured");
  const visible = products.filter(
    (product) =>
      (category === "todos" || product.category === category) &&
      product.name
        .toLocaleLowerCase("es")
        .includes(search.trim().toLocaleLowerCase("es")),
  );
  if (sort !== "featured")
    visible.sort((a, b) =>
      sort === "low"
        ? a.priceMinor - b.priceMinor
        : b.priceMinor - a.priceMinor,
    );
  return (
    <div className={`container ${styles.page}`}>
      <p className="eyebrow">Explora la colección</p>
      <h1>Tecnología que va contigo.</h1>
      <p className={styles.intro}>
        Encuentra tu próximo favorito. Celulares, audio y accesorios para cada
        momento.
      </p>
      <div className={styles.filters}>
        <Input
          ref={searchInput}
          label="Buscar producto"
          type="search"
          placeholder="¿Qué estás buscando?"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          label="Categoría"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="todos">Todas las categorías</option>
          <option value="celulares">Celulares</option>
          <option value="audio">Audio</option>
          <option value="accesorios">Accesorios</option>
        </Select>
        <Select
          label="Ordenar por"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="featured">Destacados</option>
          <option value="low">Menor precio</option>
          <option value="high">Mayor precio</option>
        </Select>
      </div>
      <p className={styles.count} role="status">
        {visible.length} productos · Colección de demostración
      </p>
      {visible.length ? (
        <div className={styles.grid}>
          {visible.map((product) => (
            <ProductCard product={product} key={product.sku} />
          ))}
        </div>
      ) : (
        <StatePanel
          kind="empty"
          title="No encontramos ese producto"
          description="Prueba otro nombre o explora todas las categorías."
          action={
            <Button
              onClick={() => {
                setSearch("");
                setCategory("todos");
                setSort("featured");
                searchInput.current?.focus();
              }}
            >
              Limpiar filtros
            </Button>
          }
        />
      )}
    </div>
  );
}
