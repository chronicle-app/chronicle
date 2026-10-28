import { sql } from '../db/sql.js';
import type { Db } from '../db/open.js';
import { chunked } from './entityIris.js';

/**
 * The sourced `handle` for each given entity, when it has one. Handle-carrying
 * entities (tags, accounts, usernames) hold their human label as a structural
 * key — e.g. a `Tag` keyed by `{handle: "watersheds"}`, a Slack agent keyed by
 * sourceId — rather than as a `name` property. Surfacing it gives such entities
 * a display name instead of rendering anonymously. Callers use it only as a
 * fallback when no elected name exists. When several sourced rows carry one,
 * the pick is deterministic: first by (source, key) order.
 */
export function sourcedHandles(db: Db, entityIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (entityIds.length === 0) return out;
  for (const chunk of chunked([...new Set(entityIds)])) {
    for (const r of db.all<{ entityId: number; handle: string }>(sql`
      SELECT entity_id AS entityId, handle FROM sourced_entities
      WHERE handle IS NOT NULL AND entity_id IN (${sql.join(
        chunk.map(id => sql`${id}`),
        sql`, `
      )})
      ORDER BY source, key
    `)) {
      if (!out.has(r.entityId)) out.set(r.entityId, r.handle);
    }
  }
  return out;
}

/**
 * The URL for each given entity, when any of its sourced rows carries one — a
 * page or bookmark identified by its url, an `ImageObject` by its CDN link, a
 * post that merely reports its permalink. Surfacing it lets the UI link out (or,
 * for images, render the bits).
 *
 * Read from the `url` column, not the keyset preimage: the preimage is absent
 * for an `@id`-only identity and is not guaranteed to exist at all, whereas the
 * column is written from the record's own field either way. The explicit order
 * also makes the pick deterministic — the previous version took whichever row
 * the scan returned first, so which url surfaced depended on insertion order.
 */
export function entityUrls(db: Db, entityIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (entityIds.length === 0) return out;
  for (const chunk of chunked([...new Set(entityIds)])) {
    for (const r of db.all<{ entityId: number; url: string }>(sql`
      SELECT se.entity_id AS entityId, se.url AS url FROM sourced_entities se
      WHERE se.url IS NOT NULL AND se.entity_id IN (${sql.join(
        chunk.map(id => sql`${id}`),
        sql`, `
      )})
      ORDER BY
        -- An address some row currently declares canonical comes first: the site's
        -- own preferred form, rather than whichever tracking-param variant you
        -- happened to load. Only OPEN runs count, so a canonical that has since
        -- moved stops winning.
        CASE WHEN EXISTS (
          SELECT 1 FROM properties p
           WHERE p.predicate = 'canonicalVersion'
             AND p.value_sourced_id = se.id
             AND p.cached_period_to IS NULL
        ) THEN 0 ELSE 1 END,
        se.source, se.key
    `)) {
      if (!out.has(r.entityId)) out.set(r.entityId, r.url);
    }
  }
  return out;
}
