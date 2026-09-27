import Link from "next/link";

export default function Home() {
  return (
    <>
      <p className="eyebrow">PLATAFORMA DE COMERCIO</p>
      <h1>
        Una base sólida.
        <br />
        Todo por construir.
      </h1>
      <p className="intro">
        La estructura inicial de GroupMG conecta catálogo, pedidos e integración
        ERP. Este entorno presenta únicamente la base del proyecto.
      </p>
      <Link className="button" href="/catalogo">
        Explorar catálogo →
      </Link>
      <section className="grid" aria-label="Áreas de la plataforma">
        {[
          [
            "01",
            "Catálogo",
            "Espacio para productos, categorías y disponibilidad.",
          ],
          ["02", "Pedidos", "Base para el recorrido de compra y seguimiento."],
          [
            "03",
            "Integración ERP",
            "Sincronización de inventario y ventas planificada.",
          ],
        ].map(([number, title, description]) => (
          <article key={number}>
            <span className="eyebrow">{number}</span>
            <h2>{title}</h2>
            <p>{description}</p>
            <small>Pendiente de implementación</small>
          </article>
        ))}
      </section>
    </>
  );
}
