import { sql } from '../db/sql.js';
import type { Db } from '../db/open.js';
import { chunked } from './entityIris.js';

/**
 * One per-source record that folded into a merged entity: the source that
 * claimed it, the content key of that claim, the single `@type` the source gave
 * it, the source's own `sourceId` and current `handle` for it (when it carried
 * them), and its identity `keyset` (the fields the source identified it by —
 * `sourceId`, `url`, `handle`, …). Surfacing these makes entity merging legible
 * — a merged entity is the union of its sourced entities.
 */
export interface SourceRecord {
  source: string;
  key: string;
  type: string;
  /** the source's own id for the record; null when it carried none */
  sourceId: string | null;
  /** the source's current handle for the record; null when no sighting carried one */
  handle: string | null;
  /** the source's own url for the record; null when no sighting carried one */
  url: string | null;
  keyset: Record<string, unknown>;
}

/** A cluster record with the sourced row's local id — walk-internal, so the
 *  per-source grain can elect from that row's own runs; never on the wire. */
export type SourceClusterRow = SourceRecord & { id: number };

/**
 * The sourced-entity cluster behind each given merged entity id: every
 * `sourced_entities` row that points at it, ordered by source. Empty array for
 * an id with no rows (shouldn't happen for a real entity).
 */
export function sourceClusters(db: Db, entityIds: number[]): Map<number, SourceClusterRow[]> {
  const out = new Map<number, SourceClusterRow[]>();
  for (const chunk of chunked([...new Set(entityIds)])) {
    for (const r of db.all<{
      id: number;
      entityId: number;
      source: string;
      key: string;
      type: string;
      sourceId: string | null;
      handle: string | null;
      url: string | null;
      keyset: unknown;
    }>(sql`
      SELECT id, entity_id AS entityId, source, key, type, source_id AS sourceId, handle, url, keyset
      FROM sourced_entities
      WHERE entity_id IN (${sql.join(
        chunk.map(id => sql`${id}`),
        sql`, `
      )})
      ORDER BY source IS NULL, source, key
    `)) {
      const list = out.get(r.entityId) ?? [];
      list.push({
        id: r.id,
        source: r.source,
        key: r.key,
        type: r.type,
        sourceId: r.sourceId,
        handle: r.handle,
        url: r.url,
        keyset: parseKeyset(r.keyset),
      });
      out.set(r.entityId, list);
    }
  }
  return out;
}

/** The keyset column is stored JSON; normalize to a plain object for the wire. */
function parseKeyset(keyset: unknown): Record<string, unknown> {
  if (keyset && typeof keyset === 'object') return keyset as Record<string, unknown>;
  if (typeof keyset === 'string') {
    try {
      return JSON.parse(keyset) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}
