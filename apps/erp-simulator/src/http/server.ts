import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { SimulatorConfig } from "../config";
import { decodeCursor } from "../inventory/inventory";
import { parseSale, SaleConflict } from "../sales/sale";
import type { SimulatorStore } from "../persistence/store";
import { serveSwagger } from "../documentation/swagger";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function reply(res: ServerResponse, status: number, body: unknown) {
  if (!res.destroyed) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (
    req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new HttpError(415, "Use application/json");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk);
    if (length > 16384) throw new HttpError(413, "Body too large");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export function createSimulatorServer(
  store: SimulatorStore,
  config: SimulatorConfig,
) {
  // Enforce the demo boundary here too, even when constructed without readConfig.
  if (!config.demo && (config.scenario !== "normal" || config.latencyMs))
    throw new Error("Fault injection requires demo mode");
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://erp");
      if (await serveSwagger(req.method, url.pathname, res)) return;
      if (req.method === "GET" && url.pathname === "/health") {
        await store.ping();
        reply(res, 200, { status: "ok" });
        return;
      }
      const inventoryRoute =
        req.method === "GET" && url.pathname === "/v1/inventory";
      const saleRoute = req.method === "POST" && url.pathname === "/v1/sales";
      if (!inventoryRoute && !saleRoute) throw new HttpError(404, "Not found");
      await delay(config.latencyMs);
      if (config.scenario === "unavailable")
        throw new HttpError(503, "Demo ERP unavailable");
      if (config.scenario === "timeout-before") {
        await delay(config.timeoutMs);
        reply(res, 504, { error: "Demo timeout before processing" });
        return;
      }

      if (inventoryRoute) {
        let after: string | undefined;
        const rawLimit = url.searchParams.get("limit") ?? "20";
        if (
          !/^\d+$/.test(rawLimit) ||
          +rawLimit < 1 ||
          +rawLimit > 100 ||
          [...url.searchParams.keys()].some(
            (k) =>
              !["cursor", "limit"].includes(k) ||
              url.searchParams.getAll(k).length !== 1,
          )
        )
          throw new HttpError(400, "Invalid pagination");
        try {
          if (url.searchParams.has("cursor"))
            after = decodeCursor(url.searchParams.get("cursor")!);
        } catch {
          throw new HttpError(400, "Invalid cursor");
        }
        const page = await store.inventory(after, +rawLimit);
        if (config.scenario === "timeout-after") await delay(config.timeoutMs);
        reply(res, 200, page);
        return;
      }
      const body = await readBody(req);
      let sale;
      const key = req.headers["idempotency-key"];
      try {
        sale = parseSale(body, typeof key === "string" ? key : undefined);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      if (url.search) throw new HttpError(400, "Unexpected query parameters");
      const result = await store.registerSale(sale, key as string);
      if (config.scenario === "timeout-after") await delay(config.timeoutMs);
      reply(res, result.created ? 201 : 200, result.sale);
    } catch (error) {
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof SaleConflict
            ? 409
            : 503;
      reply(res, status, {
        error: status === 503 ? "ERP unavailable" : (error as Error).message,
      });
    }
  });
}
