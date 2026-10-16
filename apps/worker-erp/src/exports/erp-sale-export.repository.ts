import type { Pool } from "pg";

export type ExportStatus = "processing" | "exported" | "failed";

export type BeginResult =
  | { kind: "started"; attempts: number }
  | { kind: "already_exported"; erpReference: string }
  /** Another event already exported this order: never sell it twice. */
  | { kind: "order_already_exported"; eventId: string };

const MAX_ERROR_LENGTH = 500;
const UNIQUE_VIOLATION = "23505";

/** Persistence of ERP exports (table ErpSaleExport), written by the worker only. */
export class ErpSaleExportRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Registers a processing attempt for the event. An exported event is not
   * touched again; a different event for an exported order is reported.
   */
  async begin(eventId: string, orderId: string): Promise<BeginResult> {
    try {
      const started = await this.pool.query<{ attempts: number }>(
        `INSERT INTO "ErpSaleExport" ("eventId", "orderId", "attempts", "updatedAt")
         VALUES ($1, $2, 1, now())
         ON CONFLICT ("eventId") DO UPDATE
           SET "attempts" = "ErpSaleExport"."attempts" + 1, "updatedAt" = now()
           WHERE "ErpSaleExport"."status" <> 'exported'
         RETURNING "attempts"`,
        [eventId, orderId],
      );
      if (started.rows[0]) {
        return { kind: "started", attempts: started.rows[0].attempts };
      }
      const existing = await this.pool.query<{ erpReference: string }>(
        `SELECT "erpReference" FROM "ErpSaleExport" WHERE "eventId" = $1`,
        [eventId],
      );
      return {
        kind: "already_exported",
        erpReference: existing.rows[0]!.erpReference,
      };
    } catch (error) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      const other = await this.pool.query<{ eventId: string }>(
        `SELECT "eventId"::text AS "eventId" FROM "ErpSaleExport" WHERE "orderId" = $1`,
        [orderId],
      );
      return {
        kind: "order_already_exported",
        eventId: other.rows[0]!.eventId,
      };
    }
  }

  async markExported(eventId: string, erpReference: string): Promise<void> {
    await this.pool.query(
      `UPDATE "ErpSaleExport"
       SET "status" = 'exported', "erpReference" = $2, "exportedAt" = now(),
           "lastError" = NULL, "updatedAt" = now()
       WHERE "eventId" = $1 AND "status" <> 'exported'`,
      [eventId, erpReference],
    );
  }

  async recordFailure(eventId: string, message: string): Promise<void> {
    await this.pool.query(
      `UPDATE "ErpSaleExport" SET "lastError" = $2, "updatedAt" = now()
       WHERE "eventId" = $1 AND "status" <> 'exported'`,
      [eventId, message.slice(0, MAX_ERROR_LENGTH)],
    );
  }

  async markFailed(eventId: string, message: string): Promise<void> {
    await this.pool.query(
      `UPDATE "ErpSaleExport"
       SET "status" = 'failed', "lastError" = $2, "updatedAt" = now()
       WHERE "eventId" = $1 AND "status" <> 'exported'`,
      [eventId, message.slice(0, MAX_ERROR_LENGTH)],
    );
  }
}
