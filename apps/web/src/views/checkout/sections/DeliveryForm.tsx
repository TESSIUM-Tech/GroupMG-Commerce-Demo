import { Input } from "../../../components/ui/Input/Input";
import type { DemoOrder } from "../../../services/demo-order";
import styles from "../CheckoutView.module.css";

export function DeliveryForm({
  delivery,
  onChange,
}: {
  delivery: DemoOrder["delivery"];
  onChange: (delivery: DemoOrder["delivery"]) => void;
}) {
  return (
    <section className={styles.panel}>
      <h2>
        <span>03</span> ¿Cómo quieres recibirlo?
      </h2>
      <fieldset className={styles.delivery}>
        <legend className={styles.srOnly}>Método de entrega</legend>
        <label>
          <input
            type="radio"
            name="delivery"
            checked={delivery === "pickup"}
            onChange={() => onChange("pickup")}
          />
          <strong>Retiro en local</strong>
          <small>Sin costo de entrega</small>
        </label>
        <label>
          <input
            type="radio"
            name="delivery"
            checked={delivery === "delivery"}
            onChange={() => onChange("delivery")}
          />
          <strong>Entrega a domicilio</strong>
          <small>Tarifa demo: $3,00 + IVA</small>
        </label>
      </fieldset>
      {delivery === "delivery" && (
        <div className={styles.fields}>
          <Input label="Provincia" name="province" required />
          <Input label="Ciudad" name="city" required />
          <Input label="Zona" name="zone" required />
          <Input
            label="Dirección de entrega"
            name="address"
            autoComplete="shipping street-address"
            required
          />
          <Input label="Referencia" name="reference" required />
        </div>
      )}
    </section>
  );
}
