import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { InventoryPage } from "../inventory/inventory";
import { SaleConflict, type SaleInput, type SaleResult } from "../sales/sale";

export interface SimulatorStore {
  ping(): Promise<void>;
  inventory(after: string | undefined, limit: number): Promise<InventoryPage>;
  registerSale(
    input: SaleInput,
    key: string,
  ): Promise<{ sale: SaleResult; created: boolean }>;
}

export class PostgresStore implements SimulatorStore {
  constructor(private readonly pool: Pool) {}

  async migrate() {
    // Dedicated versioned schema; transaction lock also serializes concurrent startups.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(2026101901)");
      await client.query(`CREATE SCHEMA IF NOT EXISTS erp_sim;
        CREATE TABLE IF NOT EXISTS erp_sim.schema_versions (version integer PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS erp_sim.inventory (
          sku text COLLATE "C" PRIMARY KEY, available integer NOT NULL CHECK (available >= 0), updated_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS erp_sim.sales (
          id uuid PRIMARY KEY, reference text NOT NULL UNIQUE, request_hash text NOT NULL,
          currency text NOT NULL, total_minor integer NOT NULL CHECK (total_minor > 0), created_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS erp_sim.sale_keys (
          key text PRIMARY KEY, sale_id uuid NOT NULL REFERENCES erp_sim.sales(id), request_hash text NOT NULL);
        INSERT INTO erp_sim.schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING;`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ping() {
    await this.pool.query("SELECT 1");
  }

  async inventory(
    after: string | undefined,
    limit: number,
  ): Promise<InventoryPage> {
    const { rows } = await this.pool.query<{
      sku: string;
      available: number;
      updated_at: Date;
    }>(
      'SELECT sku, available, updated_at FROM erp_sim.inventory WHERE ($1::text IS NULL OR sku > $1 COLLATE "C") ORDER BY sku LIMIT $2',
      [after ?? null, limit + 1],
    );
    const records = rows.slice(0, limit);
    return {
      records: records.map((r) => ({
        product_code: r.sku,
        quantity_available: r.available,
        modified_at: r.updated_at.toISOString(),
      })),
      next_cursor:
        rows.length > limit
          ? Buffer.from(records[records.length - 1]!.sku).toString("base64url")
          : null,
    };
  }

  async registerSale(input: SaleInput, key: string) {
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          input.reference,
          input.currency_code,
          input.gross_amount_minor,
        ]),
      )
      .digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Shared reset lock permits concurrent requests while excluding reset/seed.
      await client.query("SELECT pg_advisory_xact_lock_shared(2026101902)");
      // Both identities are serialized, in a stable order, across processes.
      for (const identity of [`key:${key}`, `ref:${input.reference}`].sort()) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [identity],
        );
      }
      const previous = await client.query<{
        id: string;
        reference: string;
        request_hash: string;
      }>(
        `SELECT s.id, s.reference, k.request_hash FROM erp_sim.sale_keys k JOIN erp_sim.sales s ON s.id=k.sale_id WHERE k.key=$1`,
        [key],
      );
      let existing = previous.rows[0];
      if (!existing) {
        existing = (
          await client.query<{
            id: string;
            reference: string;
            request_hash: string;
          }>(
            "SELECT id, reference, request_hash FROM erp_sim.sales WHERE reference=$1",
            [input.reference],
          )
        ).rows[0];
      }
      if (existing && existing.request_hash !== hash)
        throw new SaleConflict(
          "Reference or idempotency key reused with different content",
        );
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        await client.query(
          "INSERT INTO erp_sim.sales(id, reference, request_hash, currency, total_minor) VALUES ($1,$2,$3,$4,$5)",
          [
            id,
            input.reference,
            hash,
            input.currency_code,
            input.gross_amount_minor,
          ],
        );
      }
      await client.query(
        "INSERT INTO erp_sim.sale_keys(key,sale_id,request_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [key, id, hash],
      );
      await client.query("COMMIT");
      return {
        sale: { sale_id: id, reference: input.reference },
        created: !existing,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async seed(records: Array<{ sku: string; stock: number }>, reset: boolean) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(2026101902)");
      if (reset)
        await client.query(
          "TRUNCATE erp_sim.sale_keys, erp_sim.sales, erp_sim.inventory",
        );
      for (const record of records) {
        await client.query(
          "INSERT INTO erp_sim.inventory(sku,available,updated_at) VALUES ($1,$2,'2026-01-01T00:00:00Z') ON CONFLICT DO NOTHING",
          [record.sku, record.stock],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
