import type { Tx } from '../db/driver.js';
import { sql } from '../db/sql.js';

export interface UpsertSourcedEntityInput {
  /** content key of the primary @key keyset */
  key: string;
  entityId: number;
  source: string;
  /** keyset preimage, or null when identity arrived pre-derived as `@id` */
  keyset: Record<string, unknown> | null;
  /** the source's own id for the record, or null when it carried none */
  sourceId: string | null;
  /** the source's current handle for the record, or null when this sighting carried none */
  handle: string | null;
  /** the record's url, or null when this sighting carried none */
  url: string | null;
  /**
   * Identifier fields that are part of this node's keyset. Those cannot change —
   * they are the identity — so their columns are birth-record values, written
   * once and never rewritten by a later sighting. Anything else is an ordinary
   * observed value whose column is the elected current one.
   */
  keyedFields?: ReadonlySet<string>;
  /** the single @type of this source record (part of its keyset identity) */
  type: string;
}

/**
 * Upsert the per-source record. One row per source record; `entity_id` is the
 * only place harmonization is recorded, so a later merge just rewrites it. The
 * keyset and type are immutable (they are part of identity). Returns the row id.
 */
export function upsertSourcedEntity(tx: Tx, input: UpsertSourcedEntityInput): number {
  const existing = tx.get<{ id: number }>(
    sql`SELECT id FROM sourced_entities WHERE key = ${input.key}`
  );

  if (existing) {
    // Keep the harmonization pointer current (it may have moved under a merge).
    // keyset, type, and source_id are part of the row's birth record and are
    // never rewritten by a later sighting.
    //
    // handle/url are rewritten here ONLY when they are not part of the keyset —
    // an unkeyed identifier can be renamed, and this column is its current
    // value. A sighting without one is silence, not a rename. When the field IS
    // keyed it cannot change by construction, so the birth value stands and a
    // later sighting is a no-op rather than a rewrite that could depend on
    // arrival order. The Run behind an unkeyed value is the history; the
    // election reconciles this column to it.
    const keyed = input.keyedFields;
    const handle =
      input.handle !== null && !keyed?.has('handle') ? sql`, handle = ${input.handle}` : undefined;
    const url = input.url !== null && !keyed?.has('url') ? sql`, url = ${input.url}` : undefined;
    tx.run(sql`
      UPDATE sourced_entities SET entity_id = ${input.entityId}${handle}${url}
      WHERE id = ${existing.id}
    `);
    return existing.id;
  }

  return tx.get<{ id: number }>(sql`
    INSERT INTO sourced_entities (key, entity_id, source, keyset, source_id, handle, url, type)
    VALUES (${input.key}, ${input.entityId}, ${input.source},
      ${input.keyset === null ? null : JSON.stringify(input.keyset)}, ${input.sourceId},
      ${input.handle}, ${input.url}, ${input.type})
    RETURNING id
  `)!.id;
}
