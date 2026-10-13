import { Suspense } from "react";
import { CatalogView } from "../../views/catalog/CatalogView";

export const metadata = { title: "Catálogo" };

export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <div
          className="container"
          role="status"
          style={{ paddingBlock: "50px 80px" }}
        >
          <p>Cargando catálogo...</p>
        </div>
      }
    >
      <CatalogView />
    </Suspense>
  );
}
