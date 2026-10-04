export interface Product {
  sku: string;
  name: string;
  category: "celulares" | "audio" | "accesorios";
  priceMinor: number;
  imageUrl: string;
  description: string;
}
