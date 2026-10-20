const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (description: string, schema: string, example?: unknown) => ({
  description,
  content: {
    "application/json": {
      schema: ref(schema),
      ...(example === undefined ? {} : { example }),
    },
  },
});
const error = (description: string, message: string) =>
  response(description, "Error", { error: message });
const temporaryErrors = {
  "503": error(
    "PostgreSQL no disponible o escenario demo unavailable. Se puede reintentar con la misma clave.",
    "ERP unavailable",
  ),
  "504": error(
    "Escenario demo timeout-before: no se procesa la operación. El cliente puede agotar su timeout antes de recibir esta respuesta.",
    "Demo timeout before processing",
  ),
};

export const erpOpenApi = {
  openapi: "3.0.3",
  info: {
    title: "GroupMG ERP Simulator",
    version: "1.0.0",
    description:
      "ERP ficticio persistente detrás de ErpPort. Solo uso interno/demo, sin autenticación. Inventario paginado y registro de ventas; registrar una venta no descuenta inventario. Los fallos se configuran por entorno, no por endpoints. En timeout-after la venta puede quedar guardada aunque el cliente no reciba respuesta: reintentar con la misma Idempotency-Key. Seed y reset son comandos CLI, no operaciones HTTP.",
  },
  servers: [{ url: "/", description: "Mismo servidor del simulador" }],
  tags: [{ name: "Salud" }, { name: "Inventario" }, { name: "Ventas" }],
  paths: {
    "/health": {
      get: {
        tags: ["Salud"],
        operationId: "getErpHealth",
        summary: "Comprobar disponibilidad de PostgreSQL",
        description: "No aplica latencia ni fallos demo a este endpoint.",
        responses: {
          "200": response("Base de datos disponible", "Health", {
            status: "ok",
          }),
          "503": error("PostgreSQL no disponible", "ERP unavailable"),
        },
      },
    },
    "/v1/inventory": {
      get: {
        tags: ["Inventario"],
        operationId: "listErpInventory",
        summary: "Consultar inventario paginado",
        description:
          "Orden ascendente por SKU. Omite cursor en la primera página y usa next_cursor en la siguiente. next_cursor=null indica fin. No admite parámetros adicionales ni repetidos. La paginación no es una fotografía entre peticiones si los datos cambian.",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Tamaño de página.",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description:
              "Cursor opaco obtenido de next_cursor; no enviarlo vacío.",
            schema: { type: "string", minLength: 1 },
            example: "TUctREVNTy0wMDE",
          },
        ],
        responses: {
          "200": response(
            "Página de inventario; records puede estar vacío.",
            "InventoryPage",
            {
              records: [
                {
                  product_code: "MG-DEMO-001",
                  quantity_available: 20,
                  modified_at: "2026-01-01T00:00:00.000Z",
                },
              ],
              next_cursor: null,
            },
          ),
          "400": error(
            "Cursor o parámetros inválidos, repetidos o desconocidos.",
            "Invalid pagination",
          ),
          ...temporaryErrors,
        },
      },
    },
    "/v1/sales": {
      post: {
        tags: ["Ventas"],
        operationId: "registerErpSale",
        summary: "Registrar una venta de forma idempotente",
        description:
          "Misma clave o referencia y mismo contenido: devuelve el mismo sale_id, incluso después de reiniciar. Clave nueva con la misma referencia y contenido: se asocia a la venta existente. Cambiar el contenido para una clave o referencia existente devuelve 409. No admite parámetros query. El cuerpo no puede superar 16 KiB. Execute registra datos persistentes en el ERP demo.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            description:
              "Conservar al reintentar, también después de un timeout.",
            schema: {
              type: "string",
              minLength: 16,
              maxLength: 128,
              pattern: "^[A-Za-z0-9_-]{16,128}$",
            },
            example: "erp-demo-sale-00000001",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: ref("SaleInput"),
              example: {
                reference: "11111111-1111-4111-8111-111111111111",
                currency_code: "USD",
                gross_amount_minor: 22885,
              },
            },
          },
        },
        responses: {
          "201": response("Venta nueva registrada", "SaleResult"),
          "200": response(
            "Venta existente: repetición deduplicada",
            "SaleResult",
          ),
          "400": error(
            "JSON, campos, cabecera o parámetros inválidos.",
            "Invalid sale fields",
          ),
          "409": error(
            "Clave o referencia reutilizada con distinto contenido. Sin nueva venta.",
            "Reference or idempotency key reused with different content",
          ),
          "413": error("Cuerpo superior a 16 KiB", "Body too large"),
          "415": error(
            "Content-Type no es application/json",
            "Use application/json",
          ),
          ...temporaryErrors,
        },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string", example: "Invalid cursor" } },
      },
      Health: {
        type: "object",
        required: ["status"],
        properties: { status: { type: "string", enum: ["ok"] } },
      },
      InventoryRecord: {
        type: "object",
        required: ["product_code", "quantity_available", "modified_at"],
        properties: {
          product_code: {
            type: "string",
            pattern: "^[A-Za-z0-9._-]{1,100}$",
            example: "MG-DEMO-001",
          },
          quantity_available: { type: "integer", minimum: 0, example: 20 },
          modified_at: {
            type: "string",
            format: "date-time",
            example: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      InventoryPage: {
        type: "object",
        required: ["records", "next_cursor"],
        properties: {
          records: { type: "array", items: ref("InventoryRecord") },
          next_cursor: {
            type: "string",
            nullable: true,
            description: "null en la última página",
          },
        },
      },
      SaleInput: {
        type: "object",
        additionalProperties: false,
        required: ["reference", "currency_code", "gross_amount_minor"],
        properties: {
          reference: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9._-]{1,128}$",
            description: "Referencia única del pedido",
            example: "11111111-1111-4111-8111-111111111111",
          },
          currency_code: {
            type: "string",
            pattern: "^[A-Z]{3}$",
            example: "USD",
          },
          gross_amount_minor: {
            type: "integer",
            minimum: 1,
            maximum: 2147483647,
            description: "Total en unidades menores: 22885 = 228,85 USD",
            example: 22885,
          },
        },
      },
      SaleResult: {
        type: "object",
        required: ["sale_id", "reference"],
        properties: {
          sale_id: {
            type: "string",
            format: "uuid",
            example: "22222222-2222-4222-8222-222222222222",
          },
          reference: {
            type: "string",
            example: "11111111-1111-4111-8111-111111111111",
          },
        },
      },
    },
  },
};
