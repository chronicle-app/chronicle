import { assertionSourceSql } from './assertionSource.js';
import type { SqliteDriver } from './driver.js';

/**
 * Debug-only views. These exist purely to make the store legible in a SQLite
 * browser / `sqlite3` shell: they denormalize the interned literals (`vals`)
 * and the integer surrogate ids back into readable values and entity names,
 * and render the epoch-millisecond instants as ISO-ish text.
 *
 * They are deliberately NOT part of `SCHEMA_DDL` (no fold or reader queries
 * them, and that DDL drives the permutation contract). Views hold no state, carry
 * no write cost, are ignored by the derived-table wipe, and never appear in a
 * snapshot — so creating them on every store is free.
 *
 * Each view is compared against its stored definition on open and rewritten
 * (DROP + CREATE) only when the two differ, so an older store picks up schema
 * changes while an up-to-date one is opened without a single schema write —
 * a read-only open never needs them, and a read-write open beside a running
 * host must not take the write lock just to re-create an unchanged view. The
 * `debug_` prefix groups them away from the real tables. Raw `*_ms` columns
 * are kept alongside the formatted ones for sorting and exact comparison.
 */
export interface DebugView {
  name: string;
  /** The full `CREATE VIEW … AS …` statement, no trailing semicolon. */
  sql: string;
}

export const DEBUG_VIEWS: readonly DebugView[] = [
  {
    name: 'debug_entities',
    sql: `CREATE VIEW debug_entities AS
SELECT
  e.id,
  e.cached_name AS name,
  (SELECT group_concat(et.type, ', ') FROM entity_types et WHERE et.entity_id = e.id) AS types,
  (SELECT count(*) FROM sourced_entities se WHERE se.entity_id = e.id) AS sources
FROM entities e`,
  },
  {
    name: 'debug_sourced_entities',
    sql: `CREATE VIEW debug_sourced_entities AS
SELECT
  se.id,
  se.source,
  se.source_id,
  se.handle,
  se.type,
  e.cached_name AS entity_name,
  se.entity_id,
  se.key
FROM sourced_entities se
JOIN entities e ON e.id = se.entity_id`,
  },
  {
    name: 'debug_observations',
    sql: `CREATE VIEW debug_observations AS
SELECT
  subj.key AS subject_key,
  subj_e.cached_name AS subject_name,
  o.predicate,
  CASE
    WHEN o.value_id IS NOT NULL THEN v.body
    WHEN o.value_sourced_id IS NOT NULL THEN 'entity: ' || COALESCE(vs_e.cached_name, vs.key)
    WHEN o.value_location_id IS NOT NULL THEN 'location: ' || lv.payload
    ELSE '(absence)'
  END AS value,
  CASE o.grade WHEN 1 THEN 'origin' ELSE 'observed' END AS grade,
  datetime(o.valid_at / 1000, 'unixepoch') AS valid_at,
  datetime(o.observed_at / 1000, 'unixepoch') AS observed_at,
  a.type AS action_type,
  a.key AS action_key,
  ${assertionSourceSql('ep.body')} AS event_source,
  o.valid_at AS valid_at_ms,
  o.observed_at AS observed_at_ms
FROM observations o
JOIN sourced_entities subj ON subj.id = o.subject_id
JOIN entities subj_e ON subj_e.id = subj.entity_id
LEFT JOIN vals v ON v.id = o.value_id
LEFT JOIN sourced_entities vs ON vs.id = o.value_sourced_id
LEFT JOIN entities vs_e ON vs_e.id = vs.entity_id
LEFT JOIN location_values lv ON lv.id = o.value_location_id
JOIN actions a ON a.id = o.action_id
JOIN assertions ev ON ev.id = o.assertion_id
JOIN assertion_payloads ep ON ep.cid = ev.cid`,
  },
  {
    name: 'debug_properties',
    sql: `CREATE VIEW debug_properties AS
SELECT
  p.id,
  subj.key AS subject_key,
  subj_e.cached_name AS subject_name,
  p.predicate,
  CASE
    WHEN p.value_id IS NOT NULL THEN v.body
    WHEN p.value_sourced_id IS NOT NULL THEN 'entity: ' || COALESCE(vs_e.cached_name, vs.key)
    ELSE 'location: ' || lv.payload
  END AS value,
  ag_e.cached_name AS agent_name,
  obj_e.cached_name AS object_name,
  datetime(p.cached_period_from / 1000, 'unixepoch') AS period_from,
  CASE WHEN p.cached_period_to IS NULL THEN '(open)' ELSE datetime(p.cached_period_to / 1000, 'unixepoch') END AS period_to,
  CASE p.grade WHEN 1 THEN 'origin' ELSE 'observed' END AS grade,
  p.cached_period_from AS period_from_ms,
  p.cached_period_to AS period_to_ms
FROM properties p
JOIN sourced_entities subj ON subj.id = p.sourced_entity_id
JOIN entities subj_e ON subj_e.id = p.cached_entity_id
LEFT JOIN vals v ON v.id = p.value_id
LEFT JOIN sourced_entities vs ON vs.id = p.value_sourced_id
LEFT JOIN entities vs_e ON vs_e.id = vs.entity_id
LEFT JOIN location_values lv ON lv.id = p.value_location_id
LEFT JOIN entities ag_e ON ag_e.id = p.cached_agent_entity_id
LEFT JOIN entities obj_e ON obj_e.id = p.cached_object_entity_id`,
  },
  {
    name: 'debug_metrics',
    sql: `CREATE VIEW debug_metrics AS
SELECT
  m.id,
  subj.key AS subject_key,
  e.cached_name AS subject_name,
  m.predicate,
  m.value,
  datetime(m.valid_at / 1000, 'unixepoch') AS valid_at,
  datetime(m.observed_at / 1000, 'unixepoch') AS observed_at,
  m.valid_at AS valid_at_ms,
  m.observed_at AS observed_at_ms
FROM metrics m
JOIN sourced_entities subj ON subj.id = m.sourced_entity_id
JOIN entities e ON e.id = m.cached_entity_id`,
  },
  {
    name: 'debug_actions',
    sql: `CREATE VIEW debug_actions AS
SELECT
  a.id,
  a.type,
  a.source,
  ag.cached_name AS agent,
  obj.cached_name AS object,
  lloc.payload AS location,
  res.cached_name AS result,
  inst.cached_name AS instrument,
  tc.cached_name AS target,
  datetime(a.asserted_at / 1000, 'unixepoch') AS asserted_at,
  a.key,
  a.keyset,
  a.asserted_at AS asserted_at_ms
FROM actions a
LEFT JOIN entities ag ON ag.id = a.cached_agent_entity_id
LEFT JOIN entities obj ON obj.id = a.cached_object_entity_id
LEFT JOIN location_values lloc ON lloc.id = a.location_location_id
LEFT JOIN entities res ON res.id = a.cached_result_entity_id
LEFT JOIN entities inst ON inst.id = a.cached_instrument_entity_id
LEFT JOIN entities tc ON tc.id = a.cached_target_entity_id`,
  },
  {
    name: 'debug_encounters',
    sql: `CREATE VIEW debug_encounters AS
SELECT
  en.id,
  enc.cached_name AS encounterer,
  subj.cached_name AS subject,
  en.level,
  CASE
    WHEN en.level = 'interaction' THEN 'message'
    WHEN en.cached_subject_entity_id = a.cached_object_entity_id THEN 'direct'
    ELSE 'transitive'
  END AS kind,
  a.type AS action_type,
  datetime(en.cached_timestamp / 1000, 'unixepoch') AS at,
  subj_s.key AS subject_key,
  enc_s.key AS encounterer_key,
  en.cached_timestamp AS at_ms
FROM encounters en
JOIN entities subj ON subj.id = en.cached_subject_entity_id
JOIN sourced_entities subj_s ON subj_s.id = en.subject_sourced_id
JOIN actions a ON a.id = en.originating_action_id
LEFT JOIN entities enc ON enc.id = en.cached_encounterer_entity_id
LEFT JOIN sourced_entities enc_s ON enc_s.id = en.encounterer_sourced_id`,
  },
];

/** The views as one DDL script (every view dropped and recreated). */
export const DEBUG_VIEWS_DDL = DEBUG_VIEWS.map(
  v => `DROP VIEW IF EXISTS ${v.name};\n${v.sql};`
).join('\n\n');

/** Whitespace-insensitive comparison of two CREATE statements. */
function normalizeSql(sql: string): string {
  return sql.replaceAll(/\s+/g, ' ').trim();
}

/**
 * Bring every debug view up to date, touching only the ones whose stored
 * definition differs from the expected one. SQLite keeps the CREATE text in
 * `sqlite_master.sql` (with the leading keywords normalized and no trailing
 * semicolon), so an equal definition is a no-op and an up-to-date store sees
 * no schema write at all. Returns the names rewritten.
 */
export function applyDebugViews(sqlite: SqliteDriver): string[] {
  const stored = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?");
  const rewritten: string[] = [];
  for (const view of DEBUG_VIEWS) {
    const row = stored.get(view.name) as { sql: string | null } | undefined;
    if (row?.sql && normalizeSql(row.sql) === normalizeSql(view.sql)) continue;
    sqlite.exec(`DROP VIEW IF EXISTS ${view.name};\n${view.sql};`);
    rewritten.push(view.name);
  }
  return rewritten;
}
