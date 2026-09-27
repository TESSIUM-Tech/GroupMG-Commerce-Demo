export const metadata = { title: "Checkout" };
export default function Checkout() {
  return (
    <>
      <p className="eyebrow">CHECKOUT</p>
      <h1>
        Tu próxima compra
        <br />
        empieza aquí.
      </h1>
      <section className="empty">
        <h2>Checkout en preparación</h2>
        <p>Los pedidos y los pagos todavía no están habilitados.</p>
        <button disabled>Continuar al pago</button>
      </section>
    </>
  );
}
