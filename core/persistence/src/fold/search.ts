import { sql } from 'drizzle-orm';
import type { Db } from '../db/open.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Rebuild an entity's full-text row (a cache; rowid = entity id). Three tiers,
 * weighted at query time via bm25(): the elected name, the entity's own
 * current literal text, and the names of its direct associations (current
 * entity-valued properties — one hop only, which is why a name change on X
 * dirties exactly the entities holding a property whose object is X).
 */
export function updateEntityFts(tx: Tx, entityId: number): void {
  tx.run(sql`DELETE FROM entity_fts WHERE rowid = ${entityId}`);

  const entity = tx.all<{ name: string | null }>(
    sql`SELECT cached_name AS name FROM entities WHERE id = ${entityId} LIMIT 1`
  )[0];
  if (!entity) return; // merged away

  const literalRows = tx.all<{ body: string }>(sql`
    SELECT v.body AS body
    FROM properties p
    JOIN vals v ON v.id = p.value_id
    WHERE p.cached_entity_id = ${entityId}
      AND p.agent_sourced_id IS NULL
      AND p.cached_period_to IS NULL
  `);

  const associationRows = tx.all<{ name: string }>(sql`
    SELECT DISTINCT oe.cached_name AS name
    FROM properties p
    JOIN entities oe ON oe.id = p.cached_object_entity_id
    WHERE p.cached_entity_id = ${entityId}
      AND p.agent_sourced_id IS NULL
      AND p.cached_period_to IS NULL
      AND oe.cached_name IS NOT NULL
  `);

  const contents: string[] = [];
  for (const r of literalRows) {
    let v: unknown;
    try {
      v = JSON.parse(r.body);
    } catch {
      continue;
    }
    if (typeof v !== 'string') continue; // index text only, not numbers
    if (v === entity.name) continue; // the name tier already carries it
    contents.push(v);
  }

  const name = entity.name ?? '';
  const contentText = contents.sort().join(' ');
  const associationText = associationRows
    .map(r => r.name)
    .sort()
    .join(' ');
  if (name === '' && contentText === '' && associationText === '') return;

  tx.run(
    sql`INSERT INTO entity_fts(rowid, name, content_text, association_text)
        VALUES (${entityId}, ${name}, ${contentText}, ${associationText})`
  );
}
