import type { ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { erpOpenApi } from "./openapi";

const distribution: {
  getAbsoluteFSPath(): string;
} = require("swagger-ui-dist");
const assets: Record<string, { name: string; type: string }> = {
  "/docs/swagger-ui.css": {
    name: "swagger-ui.css",
    type: "text/css; charset=utf-8",
  },
  "/docs/swagger-ui-bundle.js": {
    name: "swagger-ui-bundle.js",
    type: "application/javascript; charset=utf-8",
  },
};
const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GroupMG ERP — Swagger</title><link rel="stylesheet" href="/docs/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="/docs/swagger-ui-bundle.js"></script><script src="/docs/initialize.js"></script></body></html>`;
const initializer = `window.onload = function () {
  SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true,
    validatorUrl: null, persistAuthorization: false, supportedSubmitMethods: ['get', 'post'] });
};`;

/** Exact asset allowlist: provider files and arbitrary filesystem paths are never exposed. */
export async function serveSwagger(
  method: string | undefined,
  path: string,
  res: ServerResponse,
): Promise<boolean> {
  if (method !== "GET" && method !== "HEAD") return false;
  let body: string | Buffer;
  let contentType: string;
  if (path === "/docs" || path === "/docs/") {
    body = html;
    contentType = "text/html; charset=utf-8";
  } else if (path === "/openapi.json") {
    body = JSON.stringify(erpOpenApi);
    contentType = "application/json; charset=utf-8";
  } else if (path === "/docs/initialize.js") {
    body = initializer;
    contentType = "application/javascript; charset=utf-8";
  } else {
    const asset = assets[path];
    if (!asset) return false;
    body = await readFile(join(distribution.getAbsoluteFSPath(), asset.name));
    contentType = asset.type;
  }
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(method === "HEAD" ? undefined : body);
  return true;
}
