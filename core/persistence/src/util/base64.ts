/**
 * Strict, portable base64 decoder. `Buffer` is not available on Hermes/Expo,
 * and `Buffer.from(s, 'base64')` is lenient — it silently skips characters
 * outside the alphabet, so two different malformed inputs can collapse to the
 * same bytes and mint the same attachment CID. This decoder rejects anything
 * that is not canonical, padded, standard-alphabet base64, so a bad
 * `contentData` fails loudly at ingest instead of producing a phantom blob.
 *
 * Standard alphabet only (`+` / `/`, not the URL-safe `-` / `_`); padding
 * required; length must be a multiple of 4; `=` only in the final group.
 * Arithmetic (not bitwise) so it reads the same as the rest of the codebase.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.codePointAt(i)!] = i;
  return table;
})();

export class Base64Error extends Error {}

/** Sextet value for a character code, or -1 if it is not in the alphabet. */
function sextet(code: number | undefined): number {
  return code !== undefined && code < 128 ? LOOKUP[code] : -1;
}

export function decodeBase64(input: string): Uint8Array {
  if (input.length % 4 !== 0) {
    throw new Base64Error('base64 length must be a multiple of 4');
  }
  let pad = 0;
  if (input.length > 0) {
    if (input.endsWith('==')) pad = 2;
    else if (input.endsWith('=')) pad = 1;
  }
  const outLen = (input.length / 4) * 3 - pad;
  const out = new Uint8Array(Math.max(outLen, 0));
  let o = 0;
  for (let i = 0; i < input.length; i += 4) {
    const isLastGroup = i + 4 === input.length;
    const e2 = input[i + 2] === '=';
    const e3 = input[i + 3] === '=';
    // '=' is only ever allowed in the final quartet; positions 0 and 1 are
    // never padding, and a padded 3rd char forces a padded 4th.
    if (input[i] === '=' || input[i + 1] === '=' || (!isLastGroup && (e2 || e3)) || (e2 && !e3)) {
      throw new Base64Error('misplaced base64 padding');
    }
    const s0 = sextet(input.codePointAt(i));
    const s1 = sextet(input.codePointAt(i + 1));
    const s2 = e2 ? 0 : sextet(input.codePointAt(i + 2));
    const s3 = e3 ? 0 : sextet(input.codePointAt(i + 3));
    if (s0 < 0 || s1 < 0 || s2 < 0 || s3 < 0) {
      throw new Base64Error('invalid base64 character');
    }
    // Pack four 6-bit sextets into a 24-bit number, then split into three bytes.
    const triple = s0 * 262_144 + s1 * 4096 + s2 * 64 + s3;
    out[o++] = Math.floor(triple / 65_536) % 256;
    if (!e2) out[o++] = Math.floor(triple / 256) % 256;
    if (!e3) out[o++] = triple % 256;
  }
  return out;
}
