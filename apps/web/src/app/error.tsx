"use client";
import Link from "next/link";
import { StatePanel } from "../components/ui/StatePanel/StatePanel";
import { Button } from "../components/ui/Button/Button";
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="container">
      <StatePanel
        kind="error"
        title="No pudimos cargar esta página"
        description="Inténtalo de nuevo o regresa al catálogo para seguir explorando."
        action={
          <>
            <Button onClick={retry}>Reintentar</Button>
            <Link href="/catalogo">Volver al catálogo</Link>
          </>
        }
      />
    </div>
  );
}
