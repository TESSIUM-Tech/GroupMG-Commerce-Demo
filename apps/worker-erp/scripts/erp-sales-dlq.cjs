/**
 * Inspect or reprocess the ERP sales DLQ (docs/messaging.md).
 *   node apps/worker-erp/scripts/erp-sales-dlq.cjs list
 *   node apps/worker-erp/scripts/erp-sales-dlq.cjs reprocess <eventId>
 *   node apps/worker-erp/scripts/erp-sales-dlq.cjs reprocess --all
 * Requires a build of the worker and RABBITMQ_URL (and optionally
 * DATABASE_URL to show each sale's ErpSaleExport status) in .env.
 */
const { resolve } = require("node:path");
require("dotenv").config({
  path: resolve(__dirname, "../../../.env"),
  quiet: true,
});
const amqp = require("amqplib");
const { Pool } = require("pg");
const {
  listDeadLetters,
  reprocessDeadLetters,
} = require("../dist/messaging/dead-letter-tools");
const {
  ERP_SALES_TOPOLOGY,
  assertErpSalesTopology,
} = require("../dist/messaging/rabbitmq-topology");

async function exportStatus(eventIds) {
  if (!process.env.DATABASE_URL || eventIds.length === 0) return new Map();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT "eventId"::text AS "eventId", "status", "attempts", "lastError"
       FROM "ErpSaleExport" WHERE "eventId"::text = ANY($1::text[])`,
      [eventIds],
    );
    return new Map(rows.map((row) => [row.eventId, row]));
  } finally {
    await pool.end();
  }
}

async function main() {
  const [command, target] = process.argv.slice(2);
  if (
    !["list", "reprocess"].includes(command) ||
    (command === "reprocess" && !target)
  ) {
    console.log(
      "Usage: erp-sales-dlq.cjs list | reprocess <eventId> | reprocess --all",
    );
    process.exitCode = 2;
    return;
  }
  if (!process.env.RABBITMQ_URL) throw new Error("RABBITMQ_URL is required");
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  try {
    const channel = await connection.createConfirmChannel();
    await assertErpSalesTopology(channel, ERP_SALES_TOPOLOGY);
    const summaries =
      command === "list"
        ? await listDeadLetters(channel, ERP_SALES_TOPOLOGY)
        : await reprocessDeadLetters(
            channel,
            ERP_SALES_TOPOLOGY,
            (s) => target === "--all" || s.eventId === target,
          );
    const status = await exportStatus(
      summaries.map((s) => s.eventId).filter(Boolean),
    );
    console.log(
      `${command === "list" ? "In" : "Reprocessed from"} ${ERP_SALES_TOPOLOGY.deadLetterQueue}: ${summaries.length}`,
    );
    for (const s of summaries) {
      const row = status.get(s.eventId);
      console.log(
        [
          `eventId=${s.eventId}`,
          `correlationId=${s.correlationId}`,
          `reason="${s.reason}"`,
          `at=${s.deadLetteredAt}`,
          `attempts=${s.deliveryCount}`,
          `reprocessed=${s.reprocessCount}`,
          row
            ? `export=${row.status}/${row.attempts} lastError="${row.lastError ?? ""}"`
            : "export=none",
        ].join(" "),
      );
    }
    if (command === "reprocess" && summaries.length === 0) {
      console.log(`No DLQ message matches ${target}; nothing changed.`);
      process.exitCode = 1;
    }
    await channel.close();
  } finally {
    // Closing releases any message still held: the DLQ is never drained by list.
    await connection.close();
  }
}

main().catch((error) => {
  console.error(`DLQ tool failed: ${error.message}`);
  process.exitCode = 1;
});
