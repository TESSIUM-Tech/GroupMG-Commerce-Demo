import { createHash, randomBytes } from "node:crypto";

export const RESERVATION_TTL_MS = 5 * 60_000;
export const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60_000;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 32 random bytes for the guest; only the SHA-256 is persisted. */
export function generateAccessToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return sha256(token);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

/** Stable fingerprint of a normalized request, independent of key order. */
export function hashRequest(command: unknown): string {
  return sha256(JSON.stringify(canonical(command)));
}
