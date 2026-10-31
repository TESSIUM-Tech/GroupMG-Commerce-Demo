-- CreateTable
CREATE TABLE "ErpSyncCheckpoint" (
    "id" TEXT NOT NULL DEFAULT 'inventory',
    "cursor" TEXT,
    "pageIndex" INTEGER NOT NULL DEFAULT 0,
    "itemsSynced" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "lastError" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpSyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- DEMO-13: constraints on checkpoint state
ALTER TABLE "ErpSyncCheckpoint" ADD CONSTRAINT "erp_sync_checkpoint_values" CHECK (
  "pageIndex" >= 0
  AND "itemsSynced" >= 0
  AND "status" IN ('idle', 'in_progress', 'failed')
  AND ("lastError" IS NULL OR length("lastError") <= 500)
);
