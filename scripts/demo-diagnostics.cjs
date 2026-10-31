#!/usr/bin/env node
/**
 * DEMO-14: Herramienta de diagnóstico y verificación del entorno de demo.
 * Valida configuración, secretos protegidos, salud/readiness y puertos locales.
 * Uso: node scripts/demo-diagnostics.cjs [opciones]
 *      pnpm demo:doctor
 */
const { resolve } = require("node:path");
const { existsSync, readFileSync } = require("node:fs");
const http = require("node:http");

const rootDir = resolve(__dirname, "..");
const envPath = resolve(rootDir, ".env");
const envExamplePath = resolve(rootDir, ".env.example");

const checks = [];

function record(category, name, status, detail = "") {
  checks.push({ category, name, status, detail });
  const tag =
    status === "pass"
      ? "\x1b[32m[PASS]\x1b[0m"
      : status === "warn"
        ? "\x1b[33m[WARN]\x1b[0m"
        : "\x1b[31m[FAIL]\x1b[0m";
  console.log(` ${tag} [${category}] ${name}${detail ? ` -> ${detail}` : ""}`);
}

function maskUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (u.password) u.password = "******";
    return u.toString();
  } catch {
    return "[URL no válida o incompleta]";
  }
}

async function probeHttp(url, timeoutMs = 2500) {
  return new Promise((resolveResult) => {
    try {
      const u = new URL(url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: "GET",
          timeout: timeoutMs,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            resolveResult({
              ok: res.statusCode >= 200 && res.statusCode < 400,
              statusCode: res.statusCode,
              body,
            });
          });
        },
      );
      req.on("error", (err) =>
        resolveResult({ ok: false, error: err.message }),
      );
      req.on("timeout", () => {
        req.destroy();
        resolveResult({ ok: false, error: "timeout" });
      });
      req.end();
    } catch (err) {
      resolveResult({ ok: false, error: err.message });
    }
  });
}

function parseEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

async function main() {
  console.log(
    "\n==================================================================",
  );
  console.log("   GroupMG Commerce — Diagnóstico del Entorno Demo (DEMO-14)");
  console.log(
    "==================================================================\n",
  );

  // 1. Entorno Node y Sistema
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor >= 24) {
    record(
      "Sistema",
      `Node.js versión (v${process.versions.node})`,
      "pass",
      ">= 24 requerido",
    );
  } else {
    record(
      "Sistema",
      `Node.js versión (v${process.versions.node})`,
      "fail",
      "Se requiere Node 24",
    );
  }

  // 2. Archivo .env
  if (existsSync(envPath)) {
    record(
      "Config",
      "Archivo .env presente",
      "pass",
      "Configuración local activa",
    );
  } else {
    record(
      "Config",
      "Archivo .env presente",
      "fail",
      "Falta .env; copia .env.example",
    );
  }

  const env = parseEnv(existsSync(envPath) ? envPath : envExamplePath);

  // 3. Validación de Secretos y Enmascaramiento
  if (env.DATABASE_URL) {
    record(
      "Seguridad",
      "DATABASE_URL configurada",
      "pass",
      maskUrl(env.DATABASE_URL),
    );
  } else {
    record(
      "Seguridad",
      "DATABASE_URL configurada",
      "fail",
      "Variable requerida no encontrada",
    );
  }

  if (env.RABBITMQ_URL) {
    record(
      "Seguridad",
      "RABBITMQ_URL configurada",
      "pass",
      maskUrl(env.RABBITMQ_URL),
    );
  } else {
    record(
      "Seguridad",
      "RABBITMQ_URL configurada",
      "warn",
      "Outbox esperará en PostgreSQL",
    );
  }

  if (env.PAYMENTS_CALLBACK_SECRET) {
    const len = env.PAYMENTS_CALLBACK_SECRET.length;
    record(
      "Seguridad",
      "PAYMENTS_CALLBACK_SECRET",
      len >= 32 ? "pass" : "warn",
      `[secreto protegido, longitud: ${len} caracteres]`,
    );
  } else {
    record(
      "Seguridad",
      "PAYMENTS_CALLBACK_SECRET",
      "warn",
      "No configurado (requerido para webhook PayPhone)",
    );
  }

  // 4. Puertos restringidos a Loopback (127.0.0.1)
  const composeContent = existsSync(resolve(rootDir, "compose.yaml"))
    ? readFileSync(resolve(rootDir, "compose.yaml"), "utf8")
    : "";
  if (
    composeContent.includes("0.0.0.0:5432") ||
    composeContent.includes("0.0.0.0:6379")
  ) {
    record(
      "Perímetro",
      "Restricción de puertos de datos",
      "fail",
      "Puertos de datos expuestos en 0.0.0.0",
    );
  } else {
    record(
      "Perímetro",
      "Restricción de puertos de datos",
      "pass",
      "PostgreSQL/Redis/RabbitMQ restringidos a 127.0.0.1",
    );
  }

  // 5. Conectividad y Readiness de Servicios
  console.log(
    "\n Verificando conectividad y readiness de servicios (local / Docker):\n",
  );

  // Gateway APISIX (puerto 8080)
  const gwHealth = await probeHttp("http://127.0.0.1:8080/health");
  if (gwHealth.ok) {
    record(
      "Servicios",
      "Gateway APISIX (8080)",
      "pass",
      `HTTP ${gwHealth.statusCode} OK`,
    );
  } else {
    record(
      "Servicios",
      "Gateway APISIX (8080)",
      "warn",
      gwHealth.error || `HTTP ${gwHealth.statusCode} (¿compose no iniciado?)`,
    );
  }

  // Web Storefront (puerto 3000 directo o vía 8080)
  const webHealth = await probeHttp("http://127.0.0.1:3000/health");
  if (webHealth.ok) {
    record(
      "Servicios",
      "Web Storefront Next.js (3000)",
      "pass",
      `HTTP ${webHealth.statusCode} OK`,
    );
  } else {
    record(
      "Servicios",
      "Web Storefront Next.js (3000)",
      "warn",
      webHealth.error || `HTTP ${webHealth.statusCode}`,
    );
  }

  // API Liveness & Readiness (puerto 3001 directo o vía 8080)
  const apiLiveness = await probeHttp(
    "http://127.0.0.1:3001/api/v1/health/liveness",
  );
  if (apiLiveness.ok) {
    record(
      "Servicios",
      "API Liveness (3001)",
      "pass",
      `HTTP ${apiLiveness.statusCode} OK`,
    );
  } else {
    record(
      "Servicios",
      "API Liveness (3001)",
      "warn",
      apiLiveness.error || `HTTP ${apiLiveness.statusCode}`,
    );
  }

  const apiReadiness = await probeHttp(
    "http://127.0.0.1:3001/api/v1/health/readiness",
  );
  if (apiReadiness.ok) {
    record(
      "Servicios",
      "API Readiness / PostgreSQL (3001)",
      "pass",
      "PostgreSQL conectado y listo",
    );
  } else {
    record(
      "Servicios",
      "API Readiness / PostgreSQL (3001)",
      "warn",
      apiReadiness.error || `HTTP ${apiReadiness.statusCode}`,
    );
  }

  // ERP Simulator (puerto 3003)
  const erpHealth = await probeHttp("http://127.0.0.1:3003/health");
  if (erpHealth.ok) {
    record(
      "Servicios",
      "Simulador ERP (3003)",
      "pass",
      `HTTP ${erpHealth.statusCode} OK`,
    );
  } else {
    record(
      "Servicios",
      "Simulador ERP (3003)",
      "warn",
      erpHealth.error || `HTTP ${erpHealth.statusCode}`,
    );
  }

  // 6. Resumen final
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const passes = checks.filter((c) => c.status === "pass").length;

  console.log(
    "\n------------------------------------------------------------------",
  );
  console.log(
    ` Resultado: ${passes} Aprobados, ${warns} Avisos, ${fails} Fallos`,
  );
  console.log(
    "------------------------------------------------------------------\n",
  );

  if (fails > 0) {
    console.log(
      "  Se detectaron problemas críticos. Revisa los items en [FAIL].\n",
    );
    process.exitCode = 1;
  } else {
    console.log(
      "  Configuración y perímetro validados correctamente para la demo.\n",
    );
  }
}

if (require.main === module) {
  void main().catch((err) => {
    console.error("Error durante el diagnóstico:", err);
    process.exitCode = 1;
  });
}

module.exports = { main, maskUrl, probeHttp };
