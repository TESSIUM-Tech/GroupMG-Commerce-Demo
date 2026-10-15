import type { Metadata } from "next";
import { headers } from "next/headers";
import { PaymentView } from "../../views/payment/PaymentView";

export const metadata: Metadata = {
  title: "Pago rechazado",
  robots: { index: false, follow: false },
};

export default async function RejectedPage() {
  // Prevent shared cache for order-status pages (criterion 6).
  (await headers()).get("x-no-store"); // trigger dynamic rendering
  return <PaymentView stage="rejected" />;
}
