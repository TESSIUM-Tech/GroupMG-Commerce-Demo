import { createHmac, timingSafeEqual } from "node:crypto";

export const CALLBACK_PATH = "/api/v1/payments/payphone/callback";

/**
 * PayPhone does not sign its notifications, so we sign the URL we hand it:
 * HMAC-SHA256(secret, clientTransactionId). A forged callback without the key
 * fails here; a valid one is still only a trigger to query PayPhone.
 */
export function signCallback(
  secret: string,
  clientTransactionId: string,
): string {
  return createHmac("sha256", secret)
    .update(clientTransactionId, "utf8")
    .digest("base64url");
}

/** Constant-time comparison so the signature cannot be guessed by timing. */
export function verifyCallbackSignature(
  secret: string,
  clientTransactionId: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signCallback(secret, clientTransactionId));
  const received = Buffer.from(signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export function buildResponseUrl(
  baseUrl: string,
  secret: string,
  clientTransactionId: string,
): string {
  return `${baseUrl}${CALLBACK_PATH}/${signCallback(secret, clientTransactionId)}`;
}
