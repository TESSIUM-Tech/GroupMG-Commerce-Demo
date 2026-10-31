/** Domain errors; presentation translates them to HTTP responses. */
export class OrderDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidOrderTransitionError extends OrderDomainError {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid order transition from ${from} to ${to}`);
  }
}

export class ProductUnavailableError extends OrderDomainError {
  constructor(readonly skus: string[]) {
    super("One or more products do not exist or are not published");
  }
}

export class InsufficientStockError extends OrderDomainError {
  constructor(readonly skus: string[]) {
    super("Insufficient stock for one or more products");
  }
}

export class ShippingRateUnavailableError extends OrderDomainError {
  constructor() {
    super("No shipping rate is currently valid for the requested zone");
  }
}

export class OrderAmountOutOfRangeError extends OrderDomainError {
  constructor() {
    super("Order amount exceeds the supported range");
  }
}

export class IdempotencyKeyReusedError extends OrderDomainError {
  constructor() {
    super("Idempotency key was already used with a different request");
  }
}
