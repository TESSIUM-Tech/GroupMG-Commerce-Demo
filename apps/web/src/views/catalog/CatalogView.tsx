"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Product } from "../../types/product";
import { fetchCatalogProducts } from "../../services/catalog-api";
import { Input } from "../../components/ui/Input/Input";
import { Select } from "../../components/ui/Select/Select";
import { Button } from "../../components/ui/Button/Button";
import { ProductCard } from "../../components/product/ProductCard/ProductCard";
import { StatePanel } from "../../components/ui/StatePanel/StatePanel";
import styles from "./CatalogView.module.css";

export function CatalogView() {
  const searchParams = useSearchParams();
  const searchInput = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [category, setCategory] = useState(
    searchParams.get("category") ?? "todos",
  );
  const [sort, setSort] = useState(searchParams.get("sort") ?? "featured");

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Sincroniza los filtros con la URL del navegador para compartibilidad y recarga
  const syncUrl = (
    nextSearch: string,
    nextCategory: string,
    nextSort: string,
  ) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    if (nextCategory && nextCategory !== "todos")
      params.set("category", nextCategory);
    if (nextSort && nextSort !== "featured") params.set("sort", nextSort);
    const query = params.toString();
    const newUrl = query ? `/catalogo?${query}` : `/catalogo`;
    window.history.replaceState(null, "", newUrl);
  };

  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      fetchCatalogProducts({
        q: search.trim() || undefined,
        category: category !== "todos" ? category : undefined,
        limit: 100,
      })
        .then((res) => {
          if (!isCancelled) {
            setProducts(res.items);
            setLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (!isCancelled) {
            const message =
              err instanceof Error
                ? err.message
                : "No se pudo conectar con el catálogo de la API";
            setError(message);
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [search, category, refetchTrigger]);

  const sortedProducts = [...products];
  if (sort === "low") {
    sortedProducts.sort((a, b) => a.priceMinor - b.priceMinor);
  } else if (sort === "high") {
    sortedProducts.sort((a, b) => b.priceMinor - a.priceMinor);
  }

  const handleClearFilters = () => {
    setSearch("");
    setCategory("todos");
    setSort("featured");
    syncUrl("", "todos", "featured");
    searchInput.current?.focus();
  };

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
          onChange={(event) => {
            const nextSearch = event.target.value;
            setSearch(nextSearch);
            syncUrl(nextSearch, category, sort);
          }}
        />
        <Select
          label="Categoría"
          value={category}
          onChange={(event) => {
            const nextCategory = event.target.value;
            setCategory(nextCategory);
            syncUrl(search, nextCategory, sort);
          }}
        >
          <option value="todos">Todas las categorías</option>
          <option value="celulares">Celulares</option>
          <option value="audio">Audio</option>
          <option value="accesorios">Accesorios</option>
          <option value="computacion">Computación</option>
        </Select>
        <Select
          label="Ordenar por"
          value={sort}
          onChange={(event) => {
            const nextSort = event.target.value;
            setSort(nextSort);
            syncUrl(search, category, nextSort);
          }}
        >
          <option value="featured">Destacados</option>
          <option value="low">Menor precio</option>
          <option value="high">Mayor precio</option>
        </Select>
      </div>

      <p className={styles.count} role="status">
        {loading
          ? "Consultando catálogo..."
          : error
            ? "Error de conexión"
            : `${sortedProducts.length} productos · Catálogo`}
      </p>

      {error ? (
        <StatePanel
          kind="error"
          title="No pudimos cargar los productos"
          description={error}
          action={
            <Button onClick={() => setRefetchTrigger((c) => c + 1)}>
              Reintentar
            </Button>
          }
        />
      ) : loading ? (
        <StatePanel
          kind="loading"
          title="Cargando productos..."
          description="Consultando disponibilidad en el catálogo."
        />
      ) : sortedProducts.length ? (
        <div className={styles.grid}>
          {sortedProducts.map((product) => (
            <ProductCard product={product} key={product.sku} />
          ))}
        </div>
      ) : (
        <StatePanel
          kind="empty"
          title="No encontramos ese producto"
          description="Prueba otro nombre o explora todas las categorías."
          action={<Button onClick={handleClearFilters}>Limpiar filtros</Button>}
        />
      )}
    </div>
  );
}
