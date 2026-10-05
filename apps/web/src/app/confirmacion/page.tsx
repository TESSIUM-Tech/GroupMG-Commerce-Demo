import { PaymentView } from "../../views/payment/PaymentView";
export const metadata = { title: "Confirmación" };
export default function ConfirmationPage() {
  return <PaymentView stage="confirmed" />;
}
