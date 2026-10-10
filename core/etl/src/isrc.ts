/**
 * The `isrc` namespace: International Standard Recording Codes (ISO 3901),
 * which identify a sound recording. Every service's copy of a recording
 * carries the same code, so a plugin that has one links its copy `sameAs` a
 * node in this namespace keyed by the code.
 */
export const ISRC_SOURCE = 'isrc';

// A country code, a registrant code, a two-digit year, and a five-digit number.
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

/**
 * An ISRC in its canonical form, 12 characters with no separators
 * (`USRC17607839`), from the forms sources write it in: lowercase, with
 * hyphens or spaces (`US-RC1-76-07839`), or after an `ISRC` label. `null`
 * when it isn't one.
 */
export function normalizeIsrc(value: string): string | null {
  const code = value
    .trim()
    .toUpperCase()
    .replace(/^ISRC:?\s*/, '')
    .replaceAll(/[\s-]/g, '');
  return ISRC.test(code) ? code : null;
}
