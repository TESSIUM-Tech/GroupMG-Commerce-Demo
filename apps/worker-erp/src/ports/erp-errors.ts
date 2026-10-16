/**
 * Errors an ErpPort adapter (DEMO-11) throws so the worker can decide.
 * Anything else is treated as temporary, like ErpUnavailableError.
 */

/** Timeout, 5xx or network: retry later with the same idempotency key. */
export class ErpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErpUnavailableError";
  }
}

/** The ERP refused the sale for good (invalid data): no retry, to the DLQ. */
export class ErpRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErpRejectedError";
  }
}
