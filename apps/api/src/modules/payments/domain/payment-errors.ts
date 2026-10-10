/** Payment domain errors; presentation translates them to HTTP responses. */
export class PaymentDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class PaymentsDisabledError extends PaymentDomainError {
  constructor() {
    super("Payments are not configured on this server");
  }
}

export class PayableOrderNotFoundError extends PaymentDomainError {
  constructor() {
    super("Order not found");
  }
}

export class OrderNotPayableError extends PaymentDomainError {
  constructor(readonly status: string) {
    super(`Order cannot be paid in status ${status}`);
  }
}

export class ReservationExpiredError extends PaymentDomainError {
  constructor() {
    super("The stock reservation expired; create a new order");
  }
}

export class InvalidPayPhoneNumberError extends PaymentDomainError {
  constructor() {
    super(
      "Phone must be an Ecuadorian mobile with a PayPhone account (e.g. 0991234567)",
    );
  }
}

export class PaymentRefusedByProviderError extends PaymentDomainError {
  constructor(readonly providerMessage: string) {
    super(`PayPhone refused the payment: ${providerMessage}`);
  }
}
