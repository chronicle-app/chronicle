import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

/**
 * Synchronous sha256 over raw bytes, returning the 32-byte digest.
 *
 * Portability boundary for the store's identity function. `node:crypto` is not
 * available on Hermes/Expo, so every content address — event CIDs, literal
 * value keys, keyset keys, attachment CIDs — routes through this one wrapper
 * over `@noble/hashes` (pure JS, sync, identical output on every runtime). The
 * fold mints keys inside a synchronous transaction, so the hash must stay sync.
 *
 * The output is byte-for-byte identical to `createHash('sha256')`; the
 * `cidPin.test.ts` fixtures were generated with the old node:crypto path and
 * must keep passing across this swap.
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  return nobleSha256(bytes);
}
