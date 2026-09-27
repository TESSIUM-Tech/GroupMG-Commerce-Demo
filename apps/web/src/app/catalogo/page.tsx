export const metadata = { title: "Catálogo" };
export default function Catalog() {
  return (
    <>
      <p className="eyebrow">CATÁLOGO</p>
      <h1>
        Próximamente,
        <br />
        nuestros productos.
      </h1>
      <section className="empty">
        <h2>El catálogo aún no está conectado</h2>
        <p>
          La integración de productos, precios e inventario se desarrollará en
          la siguiente etapa.
        </p>
      </section>
    </>
  );
}
