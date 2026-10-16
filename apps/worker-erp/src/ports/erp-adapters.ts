import type { ErpAdapterName } from "../config/worker.config";
import type { ErpPort } from "./erp.port";

/**
 * Selects the ErpPort implementation (anti-corruption layer). DEMO-11 adds its
 * simulated ERP adapter here; use cases do not change. "none" means no ERP is
 * available, so the worker does not consume and sales wait in the queue.
 */
export function createErpAdapter(name: ErpAdapterName): ErpPort | null {
  switch (name) {
    case "none":
      return null;
  }
}
