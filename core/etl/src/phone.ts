/**
 * Phone number utilities for ETL processing
 */
import { phone } from 'phone';

export interface PhoneParseResult {
  isValid: boolean;
  phoneNumber?: string;
  countryIso2?: string;
  countryIso3?: string;
}

/**
 * Parse and normalize a phone number
 */
export function parsePhoneNumber(phoneNumber: string): PhoneParseResult {
  const result = phone(phoneNumber);
  return {
    isValid: result.isValid,
    phoneNumber: result.phoneNumber || undefined,
    countryIso2: result.countryIso2 || undefined,
    countryIso3: result.countryIso3 || undefined,
  };
}

/**
 * Check if two phone numbers are equivalent
 */
export function arePhoneNumbersEqual(phone1: string, phone2: string): boolean {
  const parsed1 = parsePhoneNumber(phone1);
  const parsed2 = parsePhoneNumber(phone2);

  if (!parsed1.isValid || !parsed2.isValid) {
    return false;
  }

  return parsed1.phoneNumber === parsed2.phoneNumber;
}

/**
 * Normalize a phone number to E.164 format
 */
export function normalizePhoneNumber(phoneNumber: string): string | null {
  const parsed = parsePhoneNumber(phoneNumber);
  return parsed.isValid ? parsed.phoneNumber! : null;
}

/**
 * Check if a string appears to be a phone number
 */
export function isPhoneNumber(value: string): boolean {
  return parsePhoneNumber(value).isValid;
}
