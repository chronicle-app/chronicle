import { sql } from '../db/sql.js';
import type { Tx } from '../db/driver.js';
import { getPredicateAnnotation } from '../annotations/ontology.js';
import { isSpecialPredicate } from '../annotations/actionTypes.js';
import { URL_SOURCE } from '../cid/cid.js';

export interface CandidateRow {
  predicate: string;
  valueId: number | null;
  valueSourcedId: number | null;
  valueLocationId: number | null;
  literalBody: string | null;
  literalKey: string | null;
  refKey: string | null;
  locKey: string | null;
  locPayload: string | null;
  objectEntityId: number | null;
  sourcedKey: string;
  source: string;
  canonical: number;
  periodTo: number | null;
  lastConfirmedValidAt: number;
  lastConfirmedObservedAt: number;
  grade: number;
}

/**
 * Re-elect the identifier columns (`handle`, `url`) on every sourced row of this
 * entity, from that row's OWN runs — the per-source grain, since these name one
 * source's view of the thing, not the harmonized entity.
 *
 * Only unkeyed identifiers have runs at all: a keyed one is immutable, is never
 * shredded, and so is absent from this query and left at its birth value. For the
 * rest this replaces what used to be a last-sighting-wins column write — the one
 * mutable-by-arrival-order column in the store, and invisible to the permutation
 * harness because it never reached the snapshot.
 *
 * Same ranking as the entity election, so "current" means the same thing at both
 * grains: open before closed, origin before observed, latest confirmation, then a
 * content-hash tiebreak. Never local ids.
 */
export function electSourcedIdentifiers(tx: Tx, entityId: number): void {
  const rows = tx.all<{
    sourcedId: number;
    predicate: string;
    body: string | null;
    valueKey: string | null;
    periodTo: number | null;
    lastConfirmedValidAt: number;
    lastConfirmedObservedAt: number;
    grade: number;
  }>(sql`
    SELECT p.sourced_entity_id      AS sourcedId,
           p.predicate              AS predicate,
           v.body                   AS body,
           v.key                    AS valueKey,
           p.cached_period_to       AS periodTo,
           p.last_confirmed_valid_at    AS lastConfirmedValidAt,
           p.last_confirmed_observed_at AS lastConfirmedObservedAt,
           p.grade                  AS grade
      FROM properties p
      JOIN vals v ON v.id = p.value_id
     WHERE p.cached_entity_id = ${entityId}
       AND p.agent_sourced_id IS NULL
       AND p.predicate IN ('handle', 'url')
  `);
  if (rows.length === 0) return;

  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const slot = `${row.sourcedId}:${row.predicate}`;
    const held = best.get(slot);
    if (!held || outranks(row, held)) best.set(slot, row);
  }
  for (const [slot, row] of best) {
    const value = row.body === null ? null : (JSON.parse(row.body) as unknown);
    if (typeof value !== 'string') continue;
    // A closed winner means every run is closed: the identifier is currently
    // absent, and the column says so rather than keeping a stale last sighting.
    const current = row.periodTo === null ? value : null;
    const predicate = slot.slice(slot.indexOf(':') + 1);
    if (predicate === 'handle') {
      tx.run(sql`UPDATE sourced_entities SET handle = ${current} WHERE id = ${row.sourcedId}`);
    } else {
      tx.run(sql`UPDATE sourced_entities SET url = ${current} WHERE id = ${row.sourcedId}`);
    }
  }
}

/**
 * How much weight a candidate's origin carries. A row in the `url` namespace is
 * an ambient sighting OF AN ADDRESS — legitimate, often the only thing there is,
 * but nobody's considered record. Any row with a real source is a record ABOUT
 * the thing. Content-derived, so it stays a pure function of the candidate set:
 * no per-source authority table to maintain as sources are added.
 */
function authorityOf(r: { source: string }): number {
  return r.source === URL_SOURCE ? 0 : 1;
}

function outranks(
  a: {
    periodTo: number | null;
    grade: number;
    lastConfirmedValidAt: number;
    lastConfirmedObservedAt: number;
    valueKey: string | null;
  },
  b: {
    periodTo: number | null;
    grade: number;
    lastConfirmedValidAt: number;
    lastConfirmedObservedAt: number;
    valueKey: string | null;
  }
): boolean {
  const aOpen = a.periodTo === null ? 1 : 0;
  const bOpen = b.periodTo === null ? 1 : 0;
  if (aOpen !== bOpen) return aOpen > bOpen;
  if (a.grade !== b.grade) return a.grade > b.grade;
  if (a.lastConfirmedValidAt !== b.lastConfirmedValidAt)
    return a.lastConfirmedValidAt > b.lastConfirmedValidAt;
  if (a.lastConfirmedObservedAt !== b.lastConfirmedObservedAt)
    return a.lastConfirmedObservedAt > b.lastConfirmedObservedAt;
  return (a.valueKey ?? '') < (b.valueKey ?? '');
}

/** Content-hash tiebreak: the value's own identity (ref, literal, or location key). Never local ids. */
function contentKeyOf(r: CandidateRow): string {
  return r.refKey ?? r.literalKey ?? r.locKey ?? '';
}

/**
 * The single-valued election order — first criterion that discriminates wins:
 * (1) open runs over closed; (2) grade — origin over observed; (3) authority —
 * a source's record over a bare address sighting; (4) canonical — the address
 * the site declares; (5) latest last_confirmed_valid_at; (6) latest
 * last_confirmed_observed_at; (7) sourced keyset key; (8) content-hash key.
 * Never local ids. Shared by the fold and the read engine, so "current" means
 * the same thing on both sides — one election everywhere, by construction.
 */
export function compareCandidates(a: CandidateRow, b: CandidateRow): number {
  const aOpen = a.periodTo === null ? 1 : 0;
  const bOpen = b.periodTo === null ? 1 : 0;
  if (aOpen !== bOpen) return bOpen - aOpen;
  if (a.grade !== b.grade) return b.grade - a.grade;
  // A source's record of the thing outranks a sighting of an address.
  // Without this the election is pure recency, and the noisiest observer
  // always wins: ambient browsing re-asserts a page's <title> on EVERY
  // visit, so a browser's rendered title would permanently outrank a title
  // an API assigned once. Frequency is not authority.
  if (authorityOf(a) !== authorityOf(b)) return authorityOf(b) - authorityOf(a);
  // Among addresses, the one the site currently declares canonical wins.
  // Both are `source: 'url'`, so the test above cannot separate them, and
  // without this the pick falls through to a content hash — which is how a
  // page ends up titled from its `?utm_source=…` variant rather than the
  // form the site prefers.
  if (a.canonical !== b.canonical) return b.canonical - a.canonical;
  if (a.lastConfirmedValidAt !== b.lastConfirmedValidAt)
    return b.lastConfirmedValidAt - a.lastConfirmedValidAt;
  if (a.lastConfirmedObservedAt !== b.lastConfirmedObservedAt)
    return b.lastConfirmedObservedAt - a.lastConfirmedObservedAt;
  if (a.sourcedKey !== b.sourcedKey) return a.sourcedKey < b.sourcedKey ? -1 : 1;
  const ak = contentKeyOf(a);
  const bk = contentKeyOf(b);
  return ak < bk ? -1 : ak > bk ? 1 : 0;
}

/**
 * Elect the single winner from a predicate's candidate rows: the top of the
 * `compareCandidates` order. A pure function of the candidate set.
 */
export function electWinner(candidates: CandidateRow[]): CandidateRow | undefined {
  return [...candidates].sort(compareCandidates)[0];
}

/**
 * Re-elect one entity's `cached_name` (and the flat `locations` projection). A
 * deterministic function of the entity's chains only. Single-valued predicates
 * are decided by `electWinner`; see its order.
 *
 * Returns true when the elected name changed (the cross-entity invalidation
 * edge: entities referencing this one re-render their caches and FTS).
 */
export function electEntity(tx: Tx, entityId: number): boolean {
  const entity = tx.all<{ name: string | null }>(
    sql`SELECT e.cached_name AS name FROM entities e WHERE e.id = ${entityId}`
  )[0];
  if (!entity) return false; // merged away

  const rows = tx.all<CandidateRow>(sql`
    SELECT
      p.predicate                   AS predicate,
      p.value_id                    AS valueId,
      p.value_sourced_id            AS valueSourcedId,
      p.value_location_id           AS valueLocationId,
      v.body                        AS literalBody,
      v.key                         AS literalKey,
      vse.key                       AS refKey,
      lv.key                        AS locKey,
      lv.payload                    AS locPayload,
      p.cached_object_entity_id            AS objectEntityId,
      se.key                        AS sourcedKey,
      se.source                     AS source,
      CASE WHEN EXISTS (
        SELECT 1 FROM properties c
         WHERE c.predicate = 'canonicalVersion'
           AND c.value_sourced_id = p.sourced_entity_id
           AND c.cached_period_to IS NULL
      ) THEN 1 ELSE 0 END          AS canonical,
      p.cached_period_to                   AS periodTo,
      p.last_confirmed_valid_at     AS lastConfirmedValidAt,
      p.last_confirmed_observed_at  AS lastConfirmedObservedAt,
      p.grade                       AS grade
    FROM properties p
    JOIN sourced_entities se ON se.id = p.sourced_entity_id
    LEFT JOIN vals v ON v.id = p.value_id
    LEFT JOIN sourced_entities vse ON vse.id = p.value_sourced_id
    LEFT JOIN location_values lv ON lv.id = p.value_location_id
    WHERE p.cached_entity_id = ${entityId} AND p.agent_sourced_id IS NULL
  `);

  const byPredicate = new Map<string, CandidateRow[]>();
  for (const r of rows) {
    if (isSpecialPredicate(r.predicate)) continue; // rendered via anchors below
    const list = byPredicate.get(r.predicate) ?? [];
    list.push(r);
    byPredicate.set(r.predicate, list);
  }

  const cache: Record<string, unknown> = {};
  let electedName: string | null = null;

  const refName = (objectEntityId: number | null): string | null => {
    if (objectEntityId === null) return null;
    const row = tx.all<{ name: string | null }>(
      sql`SELECT cached_name AS name FROM entities WHERE id = ${objectEntityId}`
    )[0];
    return row?.name ?? null;
  };

  // The value columns are split by range, so each row knows what it is —
  // no ontology consultation needed to interpret a stored value.
  const renderValue = (r: CandidateRow): unknown => {
    if (r.valueSourcedId !== null)
      return { entityId: r.objectEntityId, name: refName(r.objectEntityId) };
    if (r.valueLocationId !== null)
      return r.locPayload === null ? null : (JSON.parse(r.locPayload) as unknown);
    return r.literalBody === null ? null : (JSON.parse(r.literalBody) as unknown);
  };
  const identOf = (r: CandidateRow): string => {
    if (r.valueId !== null) return `v${r.valueId}`;
    if (r.valueSourcedId !== null) return `s${r.valueSourcedId}`;
    return `l${r.valueLocationId}`;
  };

  for (const [predicate, candidates] of [...byPredicate.entries()].sort()) {
    const ann = getPredicateAnnotation(predicate);

    if ((ann?.cardinality ?? 'one') === 'many') {
      // Current value set: open runs, distinct by value, content-key order.
      const open = candidates.filter(r => r.periodTo === null);
      const seen = new Set<string>();
      const values = open
        .sort((a, b) => (contentKeyOf(a) < contentKeyOf(b) ? -1 : 1))
        .filter(r => (seen.has(identOf(r)) ? false : (seen.add(identOf(r)), true)))
        .map(r => renderValue(r));
      if (values.length > 0) cache[predicate] = values;
      continue;
    }

    const winner = electWinner(candidates);
    if (!winner) continue;
    // A closed winner means every run is closed (an open competitor would have
    // out-ranked it): the predicate is currently absent.
    if (winner.periodTo !== null) continue;
    cache[predicate] = renderValue(winner);
    // Only `name` becomes the display name. A `body` is content, not a name — a
    // Message keeps its body as `body` (surfaced on the action and indexed for
    // search), and stays nameless rather than titling itself with its own text.
    if (predicate === 'name' && typeof cache[predicate] === 'string') {
      electedName = cache[predicate] as string;
    }
  }

  tx.run(sql`UPDATE entities SET cached_name = ${electedName} WHERE id = ${entityId}`);

  return electedName !== entity.name;
}
