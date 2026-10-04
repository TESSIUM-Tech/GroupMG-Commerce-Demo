import type { Product } from "../../../types/product";
// Datos de presentación; disponibilidad real pendiente de conexión a la API.
export const products: Product[] = [
  {
    sku: "MG-DEMO-001",
    name: "Nova X1 · 128 GB",
    category: "celulares",
    priceMinor: 19900,
    imageUrl: "/images/phone-front.svg",
    description: "Todo tu mundo, en un solo lugar.",
  },
  {
    sku: "MG-DEMO-002",
    name: "Nova X2 · 256 GB",
    category: "celulares",
    priceMinor: 29900,
    imageUrl: "/images/phone-back.svg",
    description: "Más espacio para lo que importa.",
  },
  {
    sku: "MG-DEMO-003",
    name: "Orbit Lite · 64 GB",
    category: "celulares",
    priceMinor: 12900,
    imageUrl: "/images/phone-front.svg",
    description: "Ligero. Ágil. Siempre contigo.",
  },
  {
    sku: "MG-DEMO-007",
    name: "Audífonos Pulse",
    category: "audio",
    priceMinor: 2490,
    imageUrl: "/images/headphones.svg",
    description: "Tu música, sin distracciones.",
  },
  {
    sku: "MG-DEMO-008",
    name: "Parlante Beat",
    category: "audio",
    priceMinor: 3590,
    imageUrl: "/images/speaker.svg",
    description: "Lleva el ritmo a donde vayas.",
  },
  {
    sku: "MG-DEMO-005",
    name: "Cargador USB-C · 25 W",
    category: "accesorios",
    priceMinor: 1500,
    imageUrl: "/images/charger.svg",
    description: "Energía para seguir conectado.",
  },
];
