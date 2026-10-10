export const PAYMENTS_CONFIG = Symbol("PAYMENTS_CONFIG");

export type PaymentsMode = "disabled" | "simulated" | "payphone";
export type SimulatedOutcome = "approved" | "canceled" | "rejected";

export interface PayPhoneCredentials {
  token: string;
  /**
   * Optional in API Sale; the token is already bound to the company. Some
   * applications only expose the token, so storeId is sent only when set.
   */
  storeId: string | null;
}

export interface PaymentsConfig {
  mode: PaymentsMode;
  /** Present for payphone mode only; never logged. */
  payphone: PayPhoneCredentials | null;
  /** Public base URL that PayPhone calls back (through the gateway). */
  responseBaseUrl: string | null;
  /** HMAC key that signs our own callback URLs; never logged. */
  callbackSecret: string | null;
  /** Deterministic provider result for simulated mode (demo/tests only). */
  simulatedOutcome: SimulatedOutcome;
}

const MODES: readonly PaymentsMode[] = ["disabled", "simulated", "payphone"];
const OUTCOMES: readonly SimulatedOutcome[] = [
  "approved",
  "canceled",
  "rejected",
];
const MIN_SECRET_LENGTH = 32;

/** Configuration error that names variables but never includes their values. */
export class PaymentsConfigError extends Error {
  constructor(problems: string[]) {
    super(`Payments configuration invalid: ${problems.join("; ")}`);
    this.name = "PaymentsConfigError";
  }
}

function value(env: Record<string, string | undefined>, name: string) {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

/**
 * Reads PAYMENTS_* and PAYPHONE_* variables. Disabled by default so the API
 * still starts for anyone without PayPhone credentials.
 */
export function loadPaymentsConfig(
  env: Record<string, string | undefined> = process.env,
): PaymentsConfig {
  const problems: string[] = [];
  const mode = (value(env, "PAYMENTS_MODE") ?? "disabled") as PaymentsMode;
  if (!MODES.includes(mode)) {
    problems.push("PAYMENTS_MODE must be disabled, simulated or payphone");
  }
  const outcome = (value(env, "PAYMENTS_SIMULATED_OUTCOME") ??
    "approved") as SimulatedOutcome;
  if (!OUTCOMES.includes(outcome)) {
    problems.push(
      "PAYMENTS_SIMULATED_OUTCOME must be approved, canceled or rejected",
    );
  }
  if (problems.length > 0) throw new PaymentsConfigError(problems);

  if (mode === "disabled") {
    return {
      mode,
      payphone: null,
      responseBaseUrl: null,
      callbackSecret: null,
      simulatedOutcome: outcome,
    };
  }

  const production = env.NODE_ENV === "production";
  if (mode === "simulated" && production) {
    problems.push("PAYMENTS_MODE=simulated is not allowed in production");
  }

  const callbackSecret = value(env, "PAYMENTS_CALLBACK_SECRET");
  if (!callbackSecret) {
    problems.push("PAYMENTS_CALLBACK_SECRET is required");
  } else if (callbackSecret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `PAYMENTS_CALLBACK_SECRET must have at least ${MIN_SECRET_LENGTH} characters`,
    );
  }

  const responseBaseUrl = value(env, "PAYPHONE_RESPONSE_URL");
  let normalizedUrl: string | null = null;
  if (responseBaseUrl) {
    try {
      const url = new URL(responseBaseUrl);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
        problems.push(
          "PAYPHONE_RESPONSE_URL must use https (http only for localhost)",
        );
      } else if (url.search || url.hash) {
        problems.push("PAYPHONE_RESPONSE_URL must not contain query or hash");
      } else {
        normalizedUrl = url.toString().replace(/\/+$/, "");
      }
    } catch {
      problems.push("PAYPHONE_RESPONSE_URL must be a valid URL");
    }
  } else if (mode === "payphone") {
    problems.push("PAYPHONE_RESPONSE_URL is required");
  }

  let payphone: PayPhoneCredentials | null = null;
  if (mode === "payphone") {
    const token = value(env, "PAYPHONE_TOKEN");
    const storeId = value(env, "PAYPHONE_STORE_ID");
    if (!token) problems.push("PAYPHONE_TOKEN is required");
    if (token) payphone = { token, storeId: storeId ?? null };
  }

  if (problems.length > 0) throw new PaymentsConfigError(problems);
  return {
    mode,
    payphone,
    responseBaseUrl: normalizedUrl,
    callbackSecret: callbackSecret!,
    simulatedOutcome: outcome,
  };
}
