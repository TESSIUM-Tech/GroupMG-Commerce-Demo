import { Input } from "../../../components/ui/Input/Input";
import { Select } from "../../../components/ui/Select/Select";
import styles from "../CheckoutView.module.css";

export function CustomerForm() {
  return (
    <>
      <section className={styles.panel}>
        <h2>
          <span>01</span> Tus datos
        </h2>
        <p>Compra como invitado. Usa datos ficticios para esta demostración.</p>
        <div className={styles.fields}>
          <Input
            label="Nombres"
            name="firstName"
            autoComplete="given-name"
            required
          />
          <Input
            label="Apellidos"
            name="lastName"
            autoComplete="family-name"
            required
          />
          <Input
            label="Correo electrónico"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <Input
            label="Teléfono"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
          />
        </div>
      </section>
      <section className={styles.panel}>
        <h2>
          <span>02</span> Datos de facturación
        </h2>
        <div className={styles.fields}>
          <Select
            label="Tipo de identificación"
            name="identificationType"
            required
          >
            <option value="cedula">Cédula</option>
            <option value="ruc">RUC</option>
            <option value="passport">Pasaporte</option>
          </Select>
          <Input label="Identificación" name="identification" required />
          <Input
            label="Nombre completo o razón social"
            name="billingName"
            required
          />
          <Input
            label="Correo de facturación"
            name="billingEmail"
            type="email"
            required
          />
          <Input
            label="Dirección de facturación"
            name="billingAddress"
            required
          />
        </div>
      </section>
    </>
  );
}
