import type { Metadata } from "next";
import { Header } from "../components/layout/Header/Header";
import { Footer } from "../components/layout/Footer/Footer";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: { default: "GroupMG Commerce", template: "%s | GroupMG" },
  description:
    "Tecnología que va contigo. Celulares, audio y accesorios en GroupMG.",
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
        <Header />
        <main id="contenido">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
