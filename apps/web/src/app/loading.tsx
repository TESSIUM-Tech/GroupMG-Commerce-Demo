import { StatePanel } from "../components/ui/StatePanel/StatePanel";
export default function Loading() {
  return (
    <div className="container">
      <StatePanel
        kind="loading"
        title="Preparando tu próxima selección"
        description="Estamos cargando esta página."
      />
    </div>
  );
}
