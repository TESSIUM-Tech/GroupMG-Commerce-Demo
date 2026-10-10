export const ECUADOR_COUNTRY_CODE = "593";

export interface PayPhoneNumber {
  countryCode: string;
  /** 9 digits starting with 9, without the national leading 0. */
  phoneNumber: string;
}

/**
 * Normalizes an Ecuadorian mobile number to PayPhone's format: country code
 * 593 plus the national number without its leading 0 (the format the
 * Developers portal expects too). Only mobiles can hold a PayPhone account.
 * Returns null for anything else (landlines, other countries, typos).
 */
export function toPayPhoneNumber(input: string): PayPhoneNumber | null {
  const compact = input.trim().replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  let digits = compact.replace(/^\+/, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith(ECUADOR_COUNTRY_CODE) && digits.length === 12) {
    digits = digits.slice(ECUADOR_COUNTRY_CODE.length);
  } else if (digits.startsWith("0") && digits.length === 10) {
    digits = digits.slice(1);
  }
  if (!/^9\d{8}$/.test(digits)) return null;
  return { countryCode: ECUADOR_COUNTRY_CODE, phoneNumber: digits };
}
