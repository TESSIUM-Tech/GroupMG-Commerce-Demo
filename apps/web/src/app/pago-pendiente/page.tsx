import { PaymentView } from "../../views/payment/PaymentView";
export const metadata = { title: "Pago pendiente" };
export default function PendingPaymentPage() {
  return <PaymentView stage="pending" />;
}
