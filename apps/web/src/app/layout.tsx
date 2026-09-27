import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GroupMG Commerce", template: "%s | GroupMG" },
  description: "Base inicial de la plataforma de comercio GroupMG.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <a className="skip" href="#contenido">
          Saltar al contenido
        </a>
        <header>
          <Link className="brand" href="/">
            GROUPMG<span>COMMERCE</span>
          </Link>
          <nav aria-label="Principal">
            <Link href="/catalogo">Catálogo</Link>
            <Link href="/checkout">Checkout</Link>
          </nav>
        </header>
        <main id="contenido">{children}</main>
        <footer>GroupMG · Base de desarrollo / v0.1</footer>
      </body>
    </html>
  );
}
