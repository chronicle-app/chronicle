import { sql } from '../db/sql.js';
import type { Db } from '../db/open.js';
import { ABSENCE_KEY, canonicalJson } from '../cid/canonical.js';

/**
 * Canonical JSON snapshot of all derived state, content-keyed: every local
 * integer id is dereferenced to its content hash (keyset keys, action keys,
 * event cids, value hashes) or excluded. This is the permutation-test medium —
 * two stores hold the same derived state iff their snapshots are byte-equal —
 * and a faithful debugging dump.
 *
 * Property row ids, entity surrogate ids, and dictionary ids are excluded by
 * construction; FTS is omitted (a deterministic function of what is included).
 */
export function serializeSnapshot(db: Db): string {
  const sourcedKeyById = new Map<number, string>();
  const sourced = db.all<{
    id: number;
    key: string;
    entityId: number;
    source: string;
    type: string;
  }>(sql`SELECT id, key, entity_id AS entityId, source, type FROM sourced_entities`);
  for (const s of sourced) sourcedKeyById.set(s.id, s.key);

  const actionKeyById = new Map<number, string>();
  interface ActionRow {
    id: number;
    key: string;
    type: string;
    source: string;
    sourceId: string | null;
    assertedAt: number;
    startTime: number | null;
    endTime: number | null;
    timeEarliest: number | null;
    timeLatest: number | null;
    synthetic: number;
    foundingAssertionCid: string;
    agentSourcedId: number | null;
    objectSourcedId: number | null;
    locationLocationId: number | null;
    resultSourcedId: number | null;
    instrumentSourcedId: number | null;
    targetSourcedId: number | null;
  }
  const actionRows = db.all<ActionRow>(sql`
    SELECT id, key, type, source, source_id AS sourceId,
           asserted_at AS assertedAt, start_time AS startTime, end_time AS endTime,
           time_earliest AS timeEarliest, time_latest AS timeLatest,
           synthetic AS synthetic,
           founding_assertion_cid AS foundingAssertionCid,
           agent_sourced_id AS agentSourcedId, object_sourced_id AS objectSourcedId,
           location_location_id AS locationLocationId, result_sourced_id AS resultSourcedId,
           instrument_sourced_id AS instrumentSourcedId,
           target_sourced_id AS targetSourcedId
    FROM actions
  `);
  for (const a of actionRows) actionKeyById.set(a.id, a.key);

  // Location values are content-addressed by their own key, so an action's
  // location dereferences to that key (never a local id).
  const locationKeyById = new Map<number, string>();
  for (const row of db.all<{ id: number; key: string }>(sql`SELECT id, key FROM location_values`)) {
    locationKeyById.set(row.id, row.key);
  }

  const ref = (sourcedId: number | null): string | null =>
    sourcedId === null ? null : (sourcedKeyById.get(sourcedId) ?? `(missing:${sourcedId})`);
  const locRef = (locationId: number | null): string | null =>
    locationId === null ? null : (locationKeyById.get(locationId) ?? `(missing:${locationId})`);

  // Participant edges: every role filler — including multi-valued
  // roles the single slots can't carry — as sorted content-addressed pairs, so
  // snapshot equivalence covers them like everything else.
  const participantsByAction = new Map<number, string[]>();
  for (const row of db.all<{ actionId: number; role: string; sourcedId: number }>(
    sql`SELECT action_id AS actionId, role, sourced_id AS sourcedId FROM action_role_edges`
  )) {
    const list = participantsByAction.get(row.actionId) ?? [];
    list.push(`${row.role}:${ref(row.sourcedId)}`);
    participantsByAction.set(row.actionId, list);
  }

  const actions: Record<string, unknown> = {};
  for (const a of actionRows) {
    actions[a.key] = {
      type: a.type,
      source: a.source,
      sourceId: a.sourceId,
      assertedAt: a.assertedAt,
      startTime: a.startTime,
      endTime: a.endTime,
      timeEarliest: a.timeEarliest,
      timeLatest: a.timeLatest,
      synthetic: Boolean(a.synthetic),
      foundingAssertionCid: a.foundingAssertionCid,
      agent: ref(a.agentSourcedId),
      object: ref(a.objectSourcedId),
      location: locRef(a.locationLocationId),
      result: ref(a.resultSourcedId),
      instrument: ref(a.instrumentSourcedId),
      target: ref(a.targetSourcedId),
      participants: (participantsByAction.get(a.id) ?? []).sort(),
    };
  }

  // Entities, keyed by their smallest keyset key (the stable representative).
  const keysetsByEntity = new Map<number, string[]>();
  for (const row of db.all<{ key: string; entityId: number }>(
    sql`SELECT key, entity_id AS entityId FROM sourced_entities`
  )) {
    const list = keysetsByEntity.get(row.entityId) ?? [];
    list.push(row.key);
    keysetsByEntity.set(row.entityId, list);
  }
  const typesByEntity = new Map<number, string[]>();
  for (const row of db.all<{ type: string; entityId: number }>(
    sql`SELECT type, entity_id AS entityId FROM entity_types`
  )) {
    const list = typesByEntity.get(row.entityId) ?? [];
    list.push(row.type);
    typesByEntity.set(row.entityId, list);
  }

  const entityRows = db.all<{
    id: number;
    name: string | null;
  }>(sql`
    SELECT e.id AS id, e.cached_name AS name
    FROM entities e
  `);

  const entities: Record<string, unknown> = {};
  for (const e of entityRows) {
    const keys = (keysetsByEntity.get(e.id) ?? []).sort();
    const repKey = keys[0] ?? `(unkeyed:${e.id})`;
    entities[repKey] = {
      keysets: keys,
      types: (typesByEntity.get(e.id) ?? []).sort(),
      sourced: sourced
        .filter(s => s.entityId === e.id)
        .map(s => s.key)
        .sort(),
      name: e.name,
    };
  }

  // The observations table: one content row per (event, claim). The value columns are
  // split by range, so each row self-describes (no ontology consultation);
  // both NULL is the absence sentinel / snapshot marker.
  const observations = db
    .all<{
      subjectId: number;
      predicate: string;
      validAt: number;
      observedAt: number;
      literalKey: string | null;
      refKey: string | null;
      locKey: string | null;
      actionId: number;
      assertionCid: string;
      grade: number;
    }>(
      sql`
      SELECT o.subject_id AS subjectId, o.predicate AS predicate, o.valid_at AS validAt,
             o.observed_at AS observedAt,
             v.key AS literalKey, vse.key AS refKey, lv.key AS locKey,
             o.action_id AS actionId, e.cid AS assertionCid, o.grade AS grade
      FROM observations o
      JOIN assertions e ON e.id = o.assertion_id
      LEFT JOIN vals v ON v.id = o.value_id
      LEFT JOIN sourced_entities vse ON vse.id = o.value_sourced_id
      LEFT JOIN location_values lv ON lv.id = o.value_location_id
    `
    )
    .map(o => ({
      subject: sourcedKeyById.get(o.subjectId) ?? `(missing:${o.subjectId})`,
      predicate: o.predicate,
      validAt: o.validAt,
      observedAt: o.observedAt,
      value: o.literalKey ?? o.refKey ?? o.locKey ?? ABSENCE_KEY,
      action: actionKeyById.get(o.actionId) ?? `(missing:${o.actionId})`,
      assertion: o.assertionCid,
      grade: o.grade,
    }));

  // Property runs, fully content-dereferenced.
  const runs = db
    .all<{
      sourcedEntityId: number;
      predicate: string;
      literalBody: string | null;
      refKey: string | null;
      locKey: string | null;
      agentSourcedId: number | null;
      firstValidAt: number;
      firstObservedAt: number;
      firstActionId: number;
      lastValidAt: number;
      lastObservedAt: number;
      lastActionId: number;
      closingValidAt: number | null;
      closingObservedAt: number | null;
      closingActionId: number | null;
      periodFrom: number | null;
      periodTo: number | null;
      grade: number;
    }>(
      sql`
      SELECT p.sourced_entity_id AS sourcedEntityId, p.predicate AS predicate,
             v.body AS literalBody, vse.key AS refKey, lv.key AS locKey,
             p.agent_sourced_id AS agentSourcedId,
             p.first_observed_valid_at AS firstValidAt,
             p.first_observed_observed_at AS firstObservedAt,
             p.first_observed_action_id AS firstActionId,
             p.last_confirmed_valid_at AS lastValidAt,
             p.last_confirmed_observed_at AS lastObservedAt,
             p.last_confirmed_action_id AS lastActionId,
             p.closing_valid_at AS closingValidAt,
             p.closing_observed_at AS closingObservedAt,
             p.closing_action_id AS closingActionId,
             p.cached_period_from AS periodFrom, p.cached_period_to AS periodTo, p.grade AS grade
      FROM properties p
      LEFT JOIN vals v ON v.id = p.value_id
      LEFT JOIN sourced_entities vse ON vse.id = p.value_sourced_id
      LEFT JOIN location_values lv ON lv.id = p.value_location_id
    `
    )
    .map(p => ({
      subject: sourcedKeyById.get(p.sourcedEntityId) ?? `(missing:${p.sourcedEntityId})`,
      predicate: p.predicate,
      agent: p.agentSourcedId === null ? null : (sourcedKeyById.get(p.agentSourcedId) ?? null),
      value:
        p.refKey === null && p.locKey === null
          ? p.literalBody === null
            ? null
            : (JSON.parse(p.literalBody) as unknown)
          : { ref: (p.refKey ?? p.locKey) as string },
      first: {
        validAt: p.firstValidAt,
        observedAt: p.firstObservedAt,
        action: actionKeyById.get(p.firstActionId) ?? null,
      },
      last: {
        validAt: p.lastValidAt,
        observedAt: p.lastObservedAt,
        action: actionKeyById.get(p.lastActionId) ?? null,
      },
      closing:
        p.closingValidAt === null
          ? null
          : {
              validAt: p.closingValidAt,
              observedAt: p.closingObservedAt,
              action:
                p.closingActionId === null ? null : (actionKeyById.get(p.closingActionId) ?? null),
            },
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      grade: p.grade,
    }));

  const metrics = db
    .all<{
      sourcedEntityId: number;
      predicate: string;
      actionId: number;
      value: number;
      validAt: number;
      observedAt: number;
    }>(
      sql`
      SELECT m.sourced_entity_id AS sourcedEntityId, m.predicate AS predicate,
             m.action_id AS actionId, m.value AS value, m.valid_at AS validAt,
             m.observed_at AS observedAt
      FROM metrics m
    `
    )
    .map(m => ({
      subject: sourcedKeyById.get(m.sourcedEntityId) ?? `(missing:${m.sourcedEntityId})`,
      predicate: m.predicate,
      action: actionKeyById.get(m.actionId) ?? `(missing:${m.actionId})`,
      value: m.value,
      validAt: m.validAt,
      observedAt: m.observedAt,
    }));

  // Encounter log: one row per interaction instance. Dereferenced to
  // truth — the originating action's key and the sourced (not cached-entity)
  // keys — and NOT deduped, since post-merge duplicate rows are two real events.
  const encounters = db
    .all<{
      originatingActionId: number;
      cachedTimestamp: number;
      encountererSourcedId: number | null;
      subjectSourcedId: number;
      level: string;
    }>(
      sql`
      SELECT originating_action_id AS originatingActionId, cached_timestamp AS cachedTimestamp,
             encounterer_sourced_id AS encountererSourcedId,
             subject_sourced_id AS subjectSourcedId, level AS level
      FROM encounters
    `
    )
    .map(en => ({
      action: actionKeyById.get(en.originatingActionId) ?? `(missing:${en.originatingActionId})`,
      encounterer: ref(en.encountererSourcedId),
      subject: ref(en.subjectSourcedId),
      level: en.level,
      timestamp: en.cachedTimestamp,
    }));

  const byContent = (a: unknown, b: unknown): number => {
    const ka = canonicalJson(a);
    const kb = canonicalJson(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  observations.sort(byContent);
  runs.sort(byContent);
  metrics.sort(byContent);
  encounters.sort(byContent);

  return JSON.stringify(
    JSON.parse(
      canonicalJson({
        entities,
        actions,
        observations,
        properties: runs,
        metrics,
        encounters,
      })
    ),
    null,
    2
  );
}
