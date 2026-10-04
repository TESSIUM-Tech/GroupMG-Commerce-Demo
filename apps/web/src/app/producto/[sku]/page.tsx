import { notFound } from "next/navigation";
import { products } from "../../../views/index/data/products";
import { ProductView } from "../../../views/product/ProductView";

export function generateStaticParams() {
  return products.map(({ sku }) => ({ sku }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const product = products.find((item) => item.sku === sku);
  return { title: product?.name ?? "Producto no encontrado" };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const product = products.find((item) => item.sku === sku);
  if (!product) notFound();
  return <ProductView product={product} />;
}
