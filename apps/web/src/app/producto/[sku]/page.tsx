import { notFound } from "next/navigation";
import { ProductView } from "../../../views/product/ProductView";
import { fetchProductBySkuOrId } from "../../../services/catalog-api";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  try {
    const product = await fetchProductBySkuOrId(sku);
    if (!product) {
      return { title: "Producto no encontrado" };
    }
    return {
      title: `${product.name} · GroupMG`,
      description: `Detalles de ${product.name}. Disponibilidad y precio en GroupMG Commerce.`,
    };
  } catch {
    return { title: "Producto · GroupMG" };
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const product = await fetchProductBySkuOrId(sku);

  if (!product) {
    notFound();
  }

  return <ProductView product={product} />;
}
