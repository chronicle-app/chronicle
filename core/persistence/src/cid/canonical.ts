import { base32 } from 'multiformats/bases/base32';
import { sha256 } from './sha256.js';

/**
 * Deep, recursive, stable-key canonicalization.
 *
 * The legacy `core/database/src/utils/cid.ts` sorts only top-level keys, which
 * is fine for flat keysets but breaks set-equality for nested values: two
 * key-permuted-but-equal objects would hash and serialize differently. Every
 * compared value (event bodies, property values, multi-valued chain keys) is
 * routed through this so equal content always produces identical bytes.
 *
 * Array order is preserved — it is semantically meaningful. Only object keys
 * are reordered.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(v => canonicalize(v));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = canonicalize(source[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

/** Canonical JSON string: deterministic regardless of input key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Content key of an absence observation / snapshot marker (a observation row with
 * both value columns NULL). Sorts before every sha256 hex key.
 */
export const ABSENCE_KEY = ' absence';

/**
 * Content key: bare base32 (RFC4648 lowercase, no padding, no multibase prefix)
 * of sha256(bytes) — 52 chars. The store's single content-key encoding, shared
 * by literal/location keys here and keyset/action keys in `cid.ts`. base32 over
 * hex: shorter, case-insensitive (safe in URLs and on case-insensitive
 * filesystems), and visually uniform with the CIDs still used for event/blob
 * content addresses.
 */
export function base32Sha256(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  return base32.encode(digest).slice(1); // drop the leading 'b' multibase prefix
}

/**
 * Content key for a literal value: base32 sha256 of its canonical JSON. Used as
 * `vals.key` (the interning identity) and as the value-content tiebreak in
 * deterministic orderings — never a local integer id.
 */
export function valueKey(value: unknown): string {
  if (value === null || value === undefined) return ABSENCE_KEY;
  return base32Sha256(new TextEncoder().encode(canonicalJson(value)));
}
