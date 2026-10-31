import Link from "next/link";
import styles from "./Header.module.css";
import { CartLink } from "./CartLink";
export function Header() {
  return (
    <header>
      <div className={styles.announcement}>
        Tecnología para tu día a día · Descubre algo extraordinario
      </div>
      <div className={`container ${styles.bar}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark}>G</span> GROUPMG
        </Link>
        <nav className={styles.navigation} aria-label="Principal">
          <Link href="/#productos-estrella">Productos estrella</Link>
          <Link href="/#tienda">Tienda</Link>
          <Link href="/#beneficios">Nosotros</Link>
          <Link href="/#contacto">Contacto</Link>
        </nav>
        <CartLink />
      </div>
    </header>
  );
}
