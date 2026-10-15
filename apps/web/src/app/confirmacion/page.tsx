import type { Metadata } from "next";
import { headers } from "next/headers";
import { PaymentView } from "../../views/payment/PaymentView";

export const metadata: Metadata = {
  title: "Confirmación",
  robots: { index: false, follow: false },
};

export default async function ConfirmationPage() {
  (await headers()).get("x-no-store"); // trigger dynamic rendering → no shared cache
  return <PaymentView stage="confirmed" />;
}
