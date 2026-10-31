import type {
  Product,
  ProductListResponse,
  ProductDetailResponse,
} from "../types/product";

export interface CatalogFilters {
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
}

/**
 * Resuelve la URL base de la API según el entorno:
 * - En navegador: URL relativa (aprovecha APISIX en Docker o rewrites en Next.js local).
 * - En servidor (SSR): INTERNAL_API_URL, API_URL o resolución automática por contenedor/local.
 */
export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_API_URL || "";
  }

  if (process.env.INTERNAL_API_URL) {
    return process.env.INTERNAL_API_URL;
  }

  if (process.env.API_URL) {
    return process.env.API_URL;
  }

  if (process.env.NODE_ENV === "production") {
    return "http://api:3001";
  }

  return "http://127.0.0.1:3001";
}

/**
 * Consulta la lista de productos publicados desde la API de catálogo.
 */
export async function fetchCatalogProducts(
  filters: CatalogFilters = {},
): Promise<ProductListResponse> {
  const base = getApiBaseUrl();
  const params = new URLSearchParams();

  if (filters.q && filters.q.trim()) {
    params.set("q", filters.q.trim());
  }

  if (filters.category && filters.category !== "todos") {
    params.set("category", filters.category.trim());
  }

  if (filters.page && filters.page > 1) {
    params.set("page", String(filters.page));
  }

  params.set("limit", String(filters.limit ?? 100));

  const queryStr = params.toString();
  const endpoint = `${base}/api/v1/products${queryStr ? `?${queryStr}` : ""}`;

  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let errorDetail = "Error al consultar los productos";
    try {
      const errJson = await response.json();
      if (errJson?.message) {
        errorDetail = Array.isArray(errJson.message)
          ? errJson.message.join(", ")
          : errJson.message;
      }
    } catch {
      errorDetail = `Error de servidor (${response.status})`;
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

/**
 * Consulta una ficha de producto por identificador (UUID o SKU).
 * Si no existe, devuelve null en vez de sustituirlo con datos ficticios.
 */
export async function fetchProductBySkuOrId(
  skuOrId: string,
): Promise<Product | null> {
  const base = getApiBaseUrl();
  const trimmed = skuOrId.trim();
  if (!trimmed) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed,
    );

  if (isUuid) {
    const response = await fetch(`${base}/api/v1/products/${trimmed}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Error al consultar el producto (${response.status})`);
    }

    const data: ProductDetailResponse = await response.json();
    return data.product;
  }

  // Si es un SKU, buscamos en el catálogo por coincidencia
  const listResponse = await fetchCatalogProducts({
    q: trimmed,
    limit: 100,
  });

  const found = listResponse.items.find(
    (item) => item.sku.toLowerCase() === trimmed.toLowerCase(),
  );

  return found ?? null;
}
