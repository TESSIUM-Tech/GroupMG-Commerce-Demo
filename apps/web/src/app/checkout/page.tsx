import type { Metadata } from "next";
import { headers } from "next/headers";
import { CheckoutView } from "../../views/checkout/CheckoutView";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  // Prevent shared/CDN cache for checkout pages (criterion 6).
  (await headers()).get("x-no-store"); // trigger dynamic rendering
  return <CheckoutView />;
}
