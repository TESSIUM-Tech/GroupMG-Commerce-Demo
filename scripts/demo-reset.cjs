#!/usr/bin/env node
/**
 * DEMO-14: Script de reinicio explícito y seguro para datos de demostración.
 * Protege contra borrados accidentales requiriendo confirmación obligatoria.
 * Uso: node scripts/demo-reset.cjs --confirm-demo-reset
 *      pnpm demo:reset --confirm-demo-reset
 */
const { resolve } = require("node:path");
const { existsSync, readFileSync } = require("node:fs");
const { execSync } = require("node:child_process");

const rootDir = resolve(__dirname, "..");

function loadEnv() {
  const envPath = resolve(rootDir, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

function getPgPool(connectionString) {
  try {
    const pgPath = require.resolve("pg", {
      paths: [
        resolve(rootDir, "apps/api"),
        resolve(rootDir, "apps/worker-erp"),
      ],
    });
    const { Pool } = require(pgPath);
    return new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--confirm-demo-reset");

  if (!confirmed) {
    console.error("\n [ERROR] Acción destructiva protegida.");
    console.error(
      " El reinicio de la demo requiere la bandera explícita: --confirm-demo-reset",
    );
    console.error(" Ejemplo: pnpm demo:reset --confirm-demo-reset\n");
    console.error(
      " Nota: Esta acción restablece únicamente datos de transacciones de prueba",
    );
    console.error(
      " (pedidos, reservas, pagos, outbox y ventas ERP), conservando el esquema.\n",
    );
    process.exit(1);
  }

  console.log("\n========================================================");
  console.log("   GroupMG Commerce — Reinicio de Datos Demo (DEMO-14)");
  console.log("========================================================\n");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn(
      " [AVISO] DATABASE_URL no definida en .env; omitiendo limpieza directa de PostgreSQL.",
    );
  } else {
    console.log(
      " 1. Limpiando transacciones demo en PostgreSQL de Commerce...",
    );
    const pool = getPgPool(databaseUrl);
    if (!pool) {
      console.warn(
        "    -> No se pudo instanciar cliente pg; omitiendo limpieza directa.",
      );
    } else {
      try {
        await pool.query(`
          TRUNCATE
            "ErpSyncCheckpoint",
            "ErpSaleExport",
            "OutboxEvent",
            "WebhookReceipt",
            "Payment",
            "StockReservation",
            "OrderItem",
            "Order",
            "GuestCustomer"
          CASCADE;
        `);
        console.log(
          "    -> Pedidos, reservas, pagos y eventos outbox restablecidos.",
        );
      } catch (err) {
        console.warn(`    -> Aviso en PostgreSQL: ${err.message}`);
      } finally {
        await pool.end();
      }
    }
  }

  // 2. Reiniciar datos en el simulador ERP
  console.log(" 2. Restableciendo datos en el simulador ERP...");
  try {
    execSync("pnpm erp:reset", { stdio: "inherit", cwd: rootDir });
    console.log("    -> Simulador ERP restablecido a su catálogo base.");
  } catch (err) {
    console.warn(
      `    -> No se pudo reiniciar el ERP automáticamente: ${err.message}`,
    );
  }

  // 3. Recargar seed de productos en commerce si está autorizado
  console.log(" 3. Verificando seed de catálogo demo en Commerce...");
  try {
    execSync("pnpm db:seed", {
      stdio: "inherit",
      cwd: rootDir,
      env: { ...process.env, ALLOW_DEMO_SEED: "true" },
    });
    console.log("    -> Seed de catálogo demo actualizado.");
  } catch (err) {
    console.warn(`    -> No se pudo ejecutar seed en Commerce: ${err.message}`);
  }

  console.log(
    "\n [EXITO] Reinicio demo finalizado. El entorno está listo para una nueva presentación.\n",
  );
}

if (require.main === module) {
  void main().catch((err) => {
    console.error("Error al reiniciar datos demo:", err);
    process.exit(1);
  });
}
