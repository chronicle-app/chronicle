import * as json from 'multiformats/codecs/json';
import { CID } from 'multiformats/cid';
import { create as createDigest } from 'multiformats/hashes/digest';
import { canonicalize, canonicalJson } from './canonical.js';
import { sha256 } from './sha256.js';

const SHA2_256 = 0x12;

/**
 * CID over an event body. The canonical bytes hashed here are exactly what is
 * stored in `assertion_payloads.body`, so `sha256(body)` is directly checkable
 * against the CID. Uses deep canonicalization, so two payloads that differ only
 * in key order produce the same CID (idempotency under re-import).
 */
export function generateAssertionBodyCID(body: unknown): {
  cid: string;
  canonicalBody: string;
} {
  const canonical = canonicalize(body);
  const bytes = json.encode(canonical as Record<string, unknown>);
  const hashBytes = sha256(bytes);
  const digest = createDigest(SHA2_256, hashBytes);
  const cid = CID.create(1, json.code, digest).toString();
  return { cid, canonicalBody: canonicalJson(body) };
}

/**
 * The **claim CID**: the hash of an assertion's body with its ROOT `@assertedAt`
 * removed — the claim CID is to an Assertion what a git *tree* hash is to a
 * commit. Two Assertions with the same claim CID say the same thing at different
 * times: the original `assert` and every later `confirm` of it share a claim CID,
 * which is how the store recognizes "same claim, new sighting" and turns an
 * unchanged re-crawl into cheap confirmations instead of re-minted copies.
 *
 * Only the ROOT stamp is stripped — nested scoped `@assertedAt` are part of what
 * the claim says (a mixed-vintage payload's inner vintages are content), so they
 * stay in. Uses the same deep canonicalization as {@link generateAssertionBodyCID},
 * so it is order-independent and recomputable identically at replication receive.
 */
export function generateClaimCID(body: unknown): string {
  const source = (body ?? {}) as Record<string, unknown>;
  const withoutRootStamp: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === '@assertedAt') continue;
    withoutRootStamp[key] = value;
  }
  const canonical = canonicalize(withoutRootStamp);
  const bytes = json.encode(canonical as Record<string, unknown>);
  const hashBytes = sha256(bytes);
  const digest = createDigest(SHA2_256, hashBytes);
  return CID.create(1, json.code, digest).toString();
}
