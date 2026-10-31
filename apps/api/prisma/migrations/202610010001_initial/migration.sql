-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_payment', 'confirmed', 'canceled', 'expired', 'review_required');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'approved', 'canceled', 'rejected', 'review_required');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('active', 'consumed', 'released');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'published', 'failed');

-- CreateEnum
CREATE TYPE "IdentificationType" AS ENUM ('cedula', 'ruc', 'passport');

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT NOT NULL,
    "supplierReference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageLicense" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "productId" UUID NOT NULL,
    "warehouse" TEXT NOT NULL DEFAULT 'demo-main',
    "onHand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "sourceVersion" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "GuestCustomer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    "currency" CHAR(3) NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL,
    "shippingMinor" INTEGER NOT NULL DEFAULT 0,
    "shippingTaxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "fulfillment" TEXT NOT NULL,
    "shippingZone" TEXT,
    "shippingRateVersion" INTEGER,
    "shippingTaxRateBps" INTEGER NOT NULL DEFAULT 0,
    "shippingAddress" JSONB,
    "customerSnapshot" JSONB NOT NULL,
    "billingIdentificationType" "IdentificationType" NOT NULL,
    "billingIdentification" TEXT NOT NULL,
    "billingName" TEXT NOT NULL,
    "billingAddress" JSONB NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "accessTokenHash" CHAR(64) NOT NULL,
    "accessTokenExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "reservationExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "supplierReference" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'payphone',
    "clientTransactionId" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "amountMinor" INTEGER NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "paymentId" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMPTZ(3),
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orderId" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'order.confirmed.v1',
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "zone" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3),

    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_supplierReference_key" ON "Product"("supplierReference");

-- CreateIndex
CREATE INDEX "Product_categoryId_published_idx" ON "Product"("categoryId", "published");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_accessTokenHash_key" ON "Order"("accessTokenHash");

-- CreateIndex
CREATE INDEX "Order_status_reservationExpiresAt_idx" ON "Order"("status", "reservationExpiresAt");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_currency_key" ON "Order"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");

-- CreateIndex
CREATE INDEX "StockReservation_status_expiresAt_idx" ON "StockReservation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_orderId_productId_key" ON "StockReservation"("orderId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_clientTransactionId_key" ON "Payment"("clientTransactionId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerTransactionId_key" ON "Payment"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "WebhookReceipt_paymentId_idx" ON "WebhookReceipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_provider_eventKey_key" ON "WebhookReceipt"("provider", "eventKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_orderId_type_key" ON "OutboxEvent"("orderId", "type");

-- CreateIndex
CREATE INDEX "ShippingRate_zone_validFrom_idx" ON "ShippingRate"("zone", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRate_zone_version_key" ON "ShippingRate"("zone", "version");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "GuestCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_currency_fkey" FOREIGN KEY ("orderId", "currency") REFERENCES "Order"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_currency_fkey" FOREIGN KEY ("orderId", "currency") REFERENCES "Order"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookReceipt" ADD CONSTRAINT "WebhookReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database invariants not expressible in Prisma schema. Keep in versioned SQL.
ALTER TABLE "Category" ADD CONSTRAINT "category_nonempty" CHECK (length(trim("slug")) > 0 AND length(trim("name")) > 0);
ALTER TABLE "Product" ADD CONSTRAINT "product_values" CHECK (
  "priceMinor" > 0 AND "currency" = 'USD' AND "taxRateBps" BETWEEN 0 AND 10000
  AND length(trim("sku")) > 0 AND length(trim("supplierReference")) > 0 AND length(trim("name")) > 0
  AND length(trim("imageUrl")) > 0 AND length(trim("imageLicense")) > 0);
ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_available" CHECK (
  "onHand" >= 0 AND "reserved" >= 0 AND "reserved" <= "onHand" AND "sourceVersion" >= 0 AND "warehouse" = 'demo-main');
ALTER TABLE "GuestCustomer" ADD CONSTRAINT "customer_nonempty" CHECK (
  length(trim("firstName")) > 0 AND length(trim("lastName")) > 0 AND length(trim("email")) > 0 AND length(trim("phone")) > 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_money" CHECK (
  "currency" = 'USD' AND "subtotalMinor" >= 0 AND "taxMinor" >= 0 AND "shippingMinor" >= 0 AND "shippingTaxMinor" >= 0
  AND "totalMinor" > 0 AND "totalMinor"::bigint = "subtotalMinor"::bigint + "taxMinor" + "shippingMinor" + "shippingTaxMinor"
  AND "shippingTaxRateBps" BETWEEN 0 AND 10000);
ALTER TABLE "Order" ADD CONSTRAINT "order_fulfillment" CHECK (
  ("fulfillment" = 'pickup' AND "shippingMinor" = 0 AND "shippingTaxMinor" = 0 AND "shippingTaxRateBps" = 0
    AND "shippingZone" IS NULL AND "shippingRateVersion" IS NULL AND "shippingAddress" IS NULL)
  OR ("fulfillment" = 'courier' AND "shippingZone" IS NOT NULL AND length(trim("shippingZone")) > 0
    AND "shippingRateVersion" > 0 AND "shippingRateVersion" IS NOT NULL AND "shippingAddress" IS NOT NULL AND jsonb_typeof("shippingAddress") = 'object'));
ALTER TABLE "Order" ADD CONSTRAINT "order_snapshot" CHECK (
  jsonb_typeof("customerSnapshot") = 'object' AND jsonb_typeof("billingAddress") = 'object'
  AND length(trim("billingIdentification")) > 0 AND length(trim("billingName")) > 0 AND length(trim("billingEmail")) > 0
  AND length(trim("idempotencyKey")) > 0 AND "requestHash" ~ '^[0-9a-f]{64}$' AND "accessTokenHash" ~ '^[0-9a-f]{64}$'
  AND "reservationExpiresAt" > "createdAt" AND "accessTokenExpiresAt" > "createdAt");
ALTER TABLE "OrderItem" ADD CONSTRAINT "item_money" CHECK (
  "quantity" > 0 AND "unitPriceMinor" > 0 AND "currency" = 'USD' AND "taxRateBps" BETWEEN 0 AND 10000 AND "taxMinor" >= 0
  AND "totalMinor"::bigint = "quantity"::bigint * "unitPriceMinor" + "taxMinor"
  AND "taxMinor"::bigint = ("quantity"::bigint * "unitPriceMinor" * "taxRateBps" + 5000) / 10000
  AND length(trim("sku")) > 0 AND length(trim("supplierReference")) > 0 AND length(trim("productName")) > 0);
ALTER TABLE "StockReservation" ADD CONSTRAINT "reservation_values" CHECK ("quantity" > 0 AND "expiresAt" > "createdAt");
ALTER TABLE "Payment" ADD CONSTRAINT "payment_values" CHECK (
  "amountMinor" > 0 AND "currency" = 'USD' AND "provider" = 'payphone' AND length(trim("clientTransactionId")) > 0
  AND ("providerTransactionId" IS NULL OR length(trim("providerTransactionId")) > 0)
  AND ("status" <> 'approved' OR ("verifiedAt" IS NOT NULL AND "providerTransactionId" IS NOT NULL)));
ALTER TABLE "WebhookReceipt" ADD CONSTRAINT "receipt_values" CHECK (
  "provider" = 'payphone' AND length(trim("eventKey")) > 0 AND "payloadHash" ~ '^[0-9a-f]{64}$'
  AND ("processedAt" IS NULL OR "verifiedAt" IS NOT NULL));
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "outbox_values" CHECK (
  "type" = 'order.confirmed.v1' AND jsonb_typeof("payload") = 'object' AND "attempts" >= 0
  AND (("status" = 'published' AND "publishedAt" IS NOT NULL) OR ("status" <> 'published' AND "publishedAt" IS NULL)));
ALTER TABLE "ShippingRate" ADD CONSTRAINT "shipping_values" CHECK (
  length(trim("zone")) > 0 AND "version" > 0 AND "amountMinor" >= 0 AND "currency" = 'USD' AND "taxRateBps" BETWEEN 0 AND 10000
  AND ("validUntil" IS NULL OR "validUntil" > "validFrom"));
