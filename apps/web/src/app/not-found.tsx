import Link from "next/link";
import { StatePanel } from "../components/ui/StatePanel/StatePanel";
export default function NotFound() {
  return (
    <div className="container">
      <StatePanel
        kind="unavailable"
        title="No encontramos esta página o producto"
        description="Puede que el enlace haya cambiado. Explora nuestra colección para encontrar otra opción."
        action={<Link href="/catalogo">Explorar catálogo →</Link>}
      />
    </div>
  );
}
