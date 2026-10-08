import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { CreateOrderCommand } from "../domain/order";
import {
  IdempotencyKeyReusedError,
  InsufficientStockError,
  OrderAmountOutOfRangeError,
  ProductUnavailableError,
  ShippingRateUnavailableError,
} from "../domain/order-errors";
import type { CreateOrderDto } from "./dto/create-order.dto";

const IDENTIFICATION_FORMATS = {
  cedula: /^[0-9]{10}$/,
  ruc: /^[0-9]{13}$/,
  passport: /^[A-Za-z0-9]{5,20}$/,
} as const;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const BEARER_TOKEN = /^Bearer ([A-Za-z0-9_-]{43})$/;

export function parseIdempotencyKey(header: unknown): string {
  if (typeof header !== "string" || !IDEMPOTENCY_KEY.test(header)) {
    throw new BadRequestException(
      "Idempotency-Key header is required: 16-128 characters from A-Z, a-z, 0-9, _ or -",
    );
  }
  return header;
}

/** Returns null when the header is missing or malformed. */
export function parseBearerToken(header: unknown): string | null {
  if (typeof header !== "string") return null;
  return BEARER_TOKEN.exec(header)?.[1] ?? null;
}

/** Cross-field rules plus a plain, ordered command so equal requests hash equally. */
export function toCreateOrderCommand(dto: CreateOrderDto): CreateOrderCommand {
  const errors: string[] = [];
  const skus = dto.items.map((item) => item.sku);
  if (new Set(skus).size !== skus.length) {
    errors.push("items must not repeat a SKU");
  }
  if (dto.fulfillment.type === "pickup" && dto.fulfillment.shippingAddress) {
    errors.push("fulfillment.shippingAddress is not allowed for pickup");
  }
  const { identificationType, identification } = dto.billing;
  if (!IDENTIFICATION_FORMATS[identificationType].test(identification)) {
    errors.push(
      `billing.identification has an invalid format for ${identificationType}`,
    );
  }
  if (errors.length > 0) throw new BadRequestException(errors);

  const address = dto.fulfillment.shippingAddress;
  return {
    items: dto.items
      .map(({ sku, quantity }) => ({ sku, quantity }))
      .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)),
    customer: {
      firstName: dto.customer.firstName,
      lastName: dto.customer.lastName,
      email: dto.customer.email,
      phone: dto.customer.phone,
    },
    fulfillment:
      dto.fulfillment.type === "courier" && address
        ? {
            type: "courier",
            shippingAddress: {
              province: address.province,
              city: address.city,
              zone: address.zone,
              address: address.address,
              reference: address.reference,
            },
          }
        : { type: "pickup" },
    billing: {
      identificationType,
      identification,
      name: dto.billing.name,
      email: dto.billing.email,
      address: dto.billing.address,
    },
  };
}

/** Translates domain errors; anything else reaches the global filter as a 500. */
export function toHttpException(error: unknown): unknown {
  if (error instanceof ProductUnavailableError) {
    return new UnprocessableEntityException({
      error: "Unprocessable Entity",
      message: error.message,
      skus: error.skus,
    });
  }
  if (error instanceof InsufficientStockError) {
    return new ConflictException({
      error: "Conflict",
      message: error.message,
      skus: error.skus,
    });
  }
  if (
    error instanceof ShippingRateUnavailableError ||
    error instanceof OrderAmountOutOfRangeError ||
    error instanceof IdempotencyKeyReusedError
  ) {
    return new UnprocessableEntityException(error.message);
  }
  return error;
}
