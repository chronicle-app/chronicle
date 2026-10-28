import { eq } from 'drizzle-orm';
import type { Db } from '../db/open.js';
import { locationValues, vals } from '../db/schema.js';
import { canonicalJson, valueKey } from '../cid/canonical.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Per-fold interning cache. Scoped to a fold invocation (not module-global) so
 * tests with many in-memory databases never cross-pollute. Predicates are not
 * interned — they are carried as plain strings.
 */
export interface DictCaches {
  valsByKey: Map<string, number>;
  locationsByKey: Map<string, number>;
}

export function makeDictCaches(): DictCaches {
  return { valsByKey: new Map(), locationsByKey: new Map() };
}

/** Intern a literal value; returns its `vals.id`. Hash-keyed upsert. */
export function internVal(tx: Tx, caches: DictCaches, value: unknown): number {
  const key = valueKey(value);
  const cached = caches.valsByKey.get(key);
  if (cached !== undefined) return cached;

  tx.insert(vals)
    .values({ key, body: canonicalJson(value) })
    .onConflictDoNothing()
    .run();
  const { id } = tx.select({ id: vals.id }).from(vals).where(eq(vals.key, key)).get()!;
  caches.valsByKey.set(key, id);
  return id;
}

/**
 * Intern a raw location payload; returns its `location_values.id`. Hash-keyed
 * upsert on the canonical payload, so identical raw geo dedupes. Only the raw
 * blob is written here — coordinates are generated from it and the enrichment
 * columns are left for the geocoder. Identity is the raw hash alone, so later
 * enrichment never changes the row's key or breaks references to it.
 */
export function internLocationValue(
  tx: Tx,
  caches: DictCaches,
  payload: Record<string, unknown>
): number {
  const key = valueKey(payload);
  const cached = caches.locationsByKey.get(key);
  if (cached !== undefined) return cached;

  tx.insert(locationValues)
    .values({ key, payload: canonicalJson(payload) })
    .onConflictDoNothing()
    .run();
  const { id } = tx
    .select({ id: locationValues.id })
    .from(locationValues)
    .where(eq(locationValues.key, key))
    .get()!;
  caches.locationsByKey.set(key, id);
  return id;
}
