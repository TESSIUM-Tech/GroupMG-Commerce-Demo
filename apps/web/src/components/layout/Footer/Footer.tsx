import Link from "next/link";
import styles from "./Footer.module.css";
export function Footer() {
  return (
    <footer className={styles.footer} id="contacto">
      <div className={`container ${styles.grid}`}>
        <div>
          <Link href="/" className={styles.brand}>
            ▣ GROUPMG
          </Link>
          <p>
            Tecnología que conecta.
            <br />
            Diseñada para acompañarte.
          </p>
        </div>
        <div>
          <h2>EXPLORA</h2>
          <Link href="/#tienda">Tienda</Link>
          <Link href="/#productos-estrella">Productos estrella</Link>
          <Link href="/catalogo">Catálogo</Link>
        </div>
        <div>
          <h2>CONÓCENOS</h2>
          <Link href="/#beneficios">Nuestra propuesta</Link>
          <Link href="/#hero">Tecnología para todos</Link>
        </div>
        <div>
          <h2>SIEMPRE CERCA DE TI</h2>
          <p>
            Encuentra el equipo que va contigo y descubre nuevas formas de
            conectar.
          </p>
          <Link href="/#tienda" className={styles.action}>
            Descubre la colección ↗
          </Link>
        </div>
      </div>
      <div className={`container ${styles.bottom}`}>
        <span>© {new Date().getFullYear()} GroupMG.</span>
        <span>Catálogo de demostración · Productos ficticios</span>
      </div>
    </footer>
  );
}
