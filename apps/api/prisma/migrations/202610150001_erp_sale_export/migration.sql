-- CreateEnum
CREATE TYPE "ErpExportStatus" AS ENUM ('processing', 'exported', 'failed');

-- CreateTable
CREATE TABLE "ErpSaleExport" (
    "eventId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "ErpExportStatus" NOT NULL DEFAULT 'processing',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "erpReference" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ErpSaleExport_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErpSaleExport_orderId_key" ON "ErpSaleExport"("orderId");

-- CreateIndex
CREATE INDEX "ErpSaleExport_status_updatedAt_idx" ON "ErpSaleExport"("status", "updatedAt");

-- DEMO-12: invariants not expressible in Prisma schema. Keep in versioned SQL.
ALTER TABLE "ErpSaleExport" ADD CONSTRAINT "erp_export_values" CHECK (
  "attempts" >= 0
  AND ("lastError" IS NULL OR length("lastError") <= 500)
  AND (("status" = 'exported' AND "exportedAt" IS NOT NULL AND "erpReference" IS NOT NULL AND length(trim("erpReference")) > 0)
    OR ("status" <> 'exported' AND "exportedAt" IS NULL)));