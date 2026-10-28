import type { SqliteDriver } from './driver.js';
import { applyDebugViews } from './views.js';

/**
 * DDL for the store. Mirrors `schema.ts` (the typed query source of truth)
 * one-to-one; the two must stay in sync. In dev this is applied to test and
 * file databases directly. Any drift surfaces immediately in the permutation
 * tests.
 *
 * Foreign keys are enforced (PRAGMA foreign_keys=ON per connection) on every
 * integer reference, including the merge-rewritten `cached_*_entity_id` caches:
 * the only paths that delete an `entities` row (merge, full-rebuild wipe)
 * already rewrite or remove every referrer first, so the FKs cost nothing and
 * catch a missed rewrite at the write site.
 *
 * Not constrained, with reasons: property anchors → observation rows (composite
 * identity behind an expression index — not FK-addressable); `entity_fts`
 * (virtual table); `assertions.target_key` (truth never references derived state).
 *
 * Value columns are split by range: `value_id` → vals (literals),
 * `value_sourced_id` → sourced_entities (entity-ranged; the keyset hash IS the
 * value identity). Exactly one is set on a sighting; both NULL is the absence
 * sentinel / snapshot marker (observations only). The split keeps each reference
 * FK-checkable and makes an ontology range flip structurally visible instead
 * of silently reinterpreting stored ids.
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS assertions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cid          TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL,               -- 'assert' | 'restated' | 'confirm'; derived from the body's @kind marker
  claim_cid    TEXT NOT NULL,               -- hash of body minus root @assertedAt; shared by an assert and its confirms
  target_key   TEXT,                        -- keyset hash of the projected action; NULL for a confirm (no action body)
  asserted_at  INTEGER NOT NULL,            -- source lives in the body only: json_extract(assertion_payloads.body, '$.source')
  ingested_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assertions_target ON assertions(target_key);
CREATE INDEX IF NOT EXISTS assertions_claim ON assertions(claim_cid, kind);

CREATE TABLE IF NOT EXISTS assertion_payloads (
  cid   TEXT PRIMARY KEY REFERENCES assertions(cid),
  body  TEXT NOT NULL
);

-- Binary content referenced by assertions via attachmentCid. Metadata only —
-- the bytes live in the blob store, keyed by the same CID (CIDv1, raw codec).
CREATE TABLE IF NOT EXISTS attachments (
  cid                           TEXT PRIMARY KEY,
  size_bytes                    INTEGER NOT NULL,
  mime_type                     TEXT,
  first_observed_assertion_cid  TEXT NOT NULL REFERENCES assertions(cid),
  ingested_at                   INTEGER NOT NULL
);

-- Pairing + identity of this graph file (archive_id), stamped into the ops
-- sidecar too. Local, never hashed, never derived, excluded from DERIVED_TABLES.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Literal-value dictionary: content-addressed interning (hash -> integer id).
-- Predicates are NOT interned — they are short, low-cardinality strings, and
-- carrying the name beats a join on every read for a few bytes per row.
CREATE TABLE IF NOT EXISTS vals (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  key   TEXT NOT NULL UNIQUE,
  body  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cached_name  TEXT
);
-- Name lookups (\`name:"…"\`, \`agent:"…"\`) start here.
CREATE INDEX IF NOT EXISTS entities_name ON entities(cached_name);

CREATE TABLE IF NOT EXISTS sourced_entities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  entity_id  INTEGER NOT NULL REFERENCES entities(id),
  -- The namespace the identity belongs to: usually a product, but the protocol
  -- namespace for a portable id -- email/phone/isbn, and "url" for a
  -- url-identified entity, owned by no product however many witnessed it.
  source     TEXT NOT NULL,
  -- Keyset preimage; NULL when identity arrived pre-derived as @id (the hash is
  -- authoritative, the preimage withheld). Display fallbacks degrade to anonymous.
  keyset     TEXT,
  -- The source's own id for this record, keyset member or not. NULL when the
  -- record carried none.
  source_id  TEXT,
  -- The record's current handle (username, slug, path) and url, keyset member or
  -- not -- so they survive the keyset preimage being absent, which it already is
  -- for an @id-only identity. A keyed one cannot change, so the birth value
  -- stands; an unkeyed one is a Run and this is its elected current value.
  handle     TEXT,
  url        TEXT,
  type       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sourced_entities_entity ON sourced_entities(entity_id);

CREATE TABLE IF NOT EXISTS entity_types (
  entity_id  INTEGER NOT NULL REFERENCES entities(id),
  type       TEXT NOT NULL,
  PRIMARY KEY (type, entity_id)
);

-- Content-keyed geographic values: a dictionary (like vals) with a derived
-- enrichment layer. payload is the verbatim raw location a plugin emitted; key
-- is the hash of its canonical form, so identical raw inputs dedupe. Coordinates
-- are GENERATED from the blob (cannot drift). The admin-area FKs, postal code,
-- and provenance are filled by the geocoder — a derived function of (payload,
-- gazetteer), NULL until then. Identity is the raw hash alone, so enrichment
-- never changes the key or breaks references.
CREATE TABLE IF NOT EXISTS location_values (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT NOT NULL UNIQUE,
  payload       TEXT NOT NULL,
  latitude         REAL GENERATED ALWAYS AS (json_extract(payload, '$.latitude'))  STORED,
  longitude        REAL GENERATED ALWAYS AS (json_extract(payload, '$.longitude')) STORED,
  -- The named place this location IS (Venue/City), when a sourced entity claims
  -- it; NULL for a bare coordinate. A merge-rewritten cache, like the action
  -- role cached_*_entity_id columns.
  cached_entity_id INTEGER REFERENCES entities(id),
  country_id       INTEGER REFERENCES entities(id),
  region_id     INTEGER REFERENCES entities(id),
  locality_id   INTEGER REFERENCES entities(id),
  postal_code   TEXT,
  geocoded_by   TEXT,
  geocoded_at   INTEGER,
  gazetteer_ver TEXT,
  confidence    REAL
);
CREATE INDEX IF NOT EXISTS location_values_country  ON location_values(country_id);
CREATE INDEX IF NOT EXISTS location_values_region   ON location_values(region_id);
CREATE INDEX IF NOT EXISTS location_values_locality ON location_values(locality_id);
-- A place's location values, to find the runs that reach it through one.
CREATE INDEX IF NOT EXISTS location_values_entity   ON location_values(cached_entity_id);

-- The observations table: the log shredded into chains. One row per (assertion, claim).
-- Identity is the placement-major unique index below (IFNULL folds the two
-- nullable value columns into comparable key parts); INSERT OR IGNORE against
-- it is the entire merge protocol, and a chain recompute is a sequential
-- index-range read.
CREATE TABLE IF NOT EXISTS observations (
  subject_id         INTEGER NOT NULL REFERENCES sourced_entities(id),
  predicate          TEXT NOT NULL,
  valid_at           INTEGER NOT NULL,
  observed_at        INTEGER NOT NULL,
  value_id           INTEGER REFERENCES vals(id),
  value_sourced_id   INTEGER REFERENCES sourced_entities(id),
  value_location_id  INTEGER REFERENCES location_values(id),
  action_id          INTEGER NOT NULL REFERENCES actions(id),
  assertion_id       INTEGER NOT NULL REFERENCES assertions(id),
  grade              INTEGER NOT NULL,
  CHECK ((value_id IS NOT NULL) + (value_sourced_id IS NOT NULL) + (value_location_id IS NOT NULL) <= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS observations_identity ON observations(
  subject_id, predicate, valid_at, observed_at,
  IFNULL(value_id, 0), IFNULL(value_sourced_id, 0), IFNULL(value_location_id, 0), action_id, assertion_id
);

CREATE TABLE IF NOT EXISTS actions (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  key                          TEXT NOT NULL UNIQUE,
  -- Dedupe keyset preimage; NULL when identity arrived pre-derived as @id.
  keyset                       TEXT,
  type                         TEXT NOT NULL,
  source                       TEXT NOT NULL,
  source_id                    TEXT,
  asserted_at                  INTEGER NOT NULL,
  start_time                   INTEGER,
  end_time                     INTEGER,
  -- Resolved occurrence range (fuzzy dates): min/max-wins register narrowed
  -- across every assertion sharing the key (time_earliest = MAX of lowers,
  -- time_latest = MIN of uppers). Inverted range = surfaced conflict. NULL =
  -- no occurrence time asserted.
  time_earliest                INTEGER,
  time_latest                  INTEGER,
  -- When the action occurred (timeline placement): occurrence lower bound if
  -- known, else the sighting time. Generated/stored so timeline ordering stays
  -- indexed; recomputes when the occurrence range narrows.
  occurred_at                  INTEGER GENERATED ALWAYS AS (COALESCE(time_earliest, asserted_at)) STORED,
  -- True when the fold materialised this action (no backing source assertion); keyed
  -- by content (type + participants). UX filtering + re-election precedence only.
  synthetic                    INTEGER NOT NULL DEFAULT 0,
  founding_assertion_cid              TEXT NOT NULL REFERENCES assertions(cid),
  agent_sourced_id                    INTEGER REFERENCES sourced_entities(id),
  cached_agent_entity_id              INTEGER REFERENCES entities(id),
  object_sourced_id                   INTEGER REFERENCES sourced_entities(id),
  cached_object_entity_id             INTEGER REFERENCES entities(id),
  location_location_id                INTEGER REFERENCES location_values(id),
  result_sourced_id                   INTEGER REFERENCES sourced_entities(id),
  cached_result_entity_id             INTEGER REFERENCES entities(id),
  instrument_sourced_id               INTEGER REFERENCES sourced_entities(id),
  cached_instrument_entity_id         INTEGER REFERENCES entities(id),
  target_sourced_id        INTEGER REFERENCES sourced_entities(id),
  cached_target_entity_id  INTEGER REFERENCES entities(id)
);
CREATE INDEX IF NOT EXISTS actions_asserted ON actions(asserted_at, id);
CREATE INDEX IF NOT EXISTS actions_occurred ON actions(occurred_at, id);
-- Occurrence ranges by their upper bound, and the actions with no occurrence
-- time, so a time-window filter reads only the actions near the window.
CREATE INDEX IF NOT EXISTS actions_latest ON actions(time_latest);
CREATE INDEX IF NOT EXISTS actions_timeless ON actions(time_latest) WHERE time_earliest IS NULL;
CREATE INDEX IF NOT EXISTS actions_type_asserted ON actions(type, asserted_at, id);
CREATE INDEX IF NOT EXISTS actions_object_entity ON actions(cached_object_entity_id);
CREATE INDEX IF NOT EXISTS actions_agent_entity ON actions(cached_agent_entity_id);
CREATE INDEX IF NOT EXISTS actions_result_entity ON actions(cached_result_entity_id);
CREATE INDEX IF NOT EXISTS actions_location ON actions(location_location_id);
CREATE INDEX IF NOT EXISTS actions_type_object ON actions(type, cached_object_entity_id);
CREATE INDEX IF NOT EXISTS actions_object_sourced_type ON actions(object_sourced_id, type);

-- Encounter event log: one row per interaction instance — the
-- point-event index behind "every interaction with X over time" and
-- recency-sort. Fully derived, append-only, idempotent per originating action
-- (delete-by-action then re-emit at shred).
-- Each endpoint is a truth/cache pair: _sourced_id is FK-enforced truth, the
-- cached_*_entity_id is the merge-rewritten cache the hot queries hit.
-- encounterer_* are NULL for a self-authored action. level grades contact:
-- 'encounter' (one-directional — consume/like/bookmark/visit, or a phase-2
-- transitive target) vs 'interaction' (two-way messaging).
CREATE TABLE IF NOT EXISTS encounters (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  originating_action_id     INTEGER NOT NULL REFERENCES actions(id),
  cached_timestamp          INTEGER NOT NULL,
  encounterer_sourced_id    INTEGER REFERENCES sourced_entities(id),
  cached_encounterer_entity_id INTEGER REFERENCES entities(id),
  subject_sourced_id        INTEGER NOT NULL REFERENCES sourced_entities(id),
  cached_subject_entity_id  INTEGER NOT NULL REFERENCES entities(id),
  level                     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS encounters_pair ON encounters(cached_encounterer_entity_id, cached_subject_entity_id, cached_timestamp);
CREATE INDEX IF NOT EXISTS encounters_subject ON encounters(cached_subject_entity_id, cached_timestamp);
CREATE INDEX IF NOT EXISTS encounters_action ON encounters(originating_action_id);

-- Participant edges: one row per (action, role, entity filler) —
-- every filler of every role, including the multi-valued roles
-- (recipient/attendee/with) that have no single-FK slot on actions, and any
-- extra fillers beyond a slot's first-entity cache. sourced_id is FK-enforced
-- truth; cached_entity_id is the merge-rewritten cache the queries hit.
CREATE TABLE IF NOT EXISTS action_role_edges (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id         INTEGER NOT NULL REFERENCES actions(id),
  role              TEXT NOT NULL,
  sourced_id        INTEGER NOT NULL REFERENCES sourced_entities(id),
  cached_entity_id  INTEGER NOT NULL REFERENCES entities(id),
  UNIQUE (action_id, role, sourced_id)
);
CREATE INDEX IF NOT EXISTS action_role_edges_action ON action_role_edges(action_id, role);
CREATE INDEX IF NOT EXISTS action_role_edges_entity ON action_role_edges(cached_entity_id);

-- Derived validity runs. Anchors are observation references (valid_at,
-- observed_at, action_id); period bounds derive FROM anchors. Special
-- properties (encountered/liked/...) live here with the agent columns set.
-- A run always carries a value, so exactly one value column is set.
CREATE TABLE IF NOT EXISTS properties (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  sourced_entity_id            INTEGER NOT NULL REFERENCES sourced_entities(id),
  cached_entity_id             INTEGER NOT NULL REFERENCES entities(id),
  predicate                    TEXT NOT NULL,
  value_id                     INTEGER REFERENCES vals(id),
  value_sourced_id             INTEGER REFERENCES sourced_entities(id),
  value_location_id            INTEGER REFERENCES location_values(id),
  agent_sourced_id             INTEGER REFERENCES sourced_entities(id),
  cached_agent_entity_id       INTEGER REFERENCES entities(id),
  cached_object_entity_id      INTEGER REFERENCES entities(id),
  first_observed_valid_at      INTEGER NOT NULL,
  first_observed_observed_at   INTEGER NOT NULL,
  first_observed_action_id     INTEGER NOT NULL REFERENCES actions(id),
  last_confirmed_valid_at      INTEGER NOT NULL,
  last_confirmed_observed_at   INTEGER NOT NULL,
  last_confirmed_action_id     INTEGER NOT NULL REFERENCES actions(id),
  closing_valid_at             INTEGER,
  closing_observed_at          INTEGER,
  closing_action_id            INTEGER REFERENCES actions(id),
  cached_period_from           INTEGER,
  cached_period_to             INTEGER,
  originator_action_id         INTEGER REFERENCES actions(id),
  grade                        INTEGER NOT NULL DEFAULT 0,
  CHECK ((value_id IS NOT NULL) + (value_sourced_id IS NOT NULL) + (value_location_id IS NOT NULL) = 1)
);
CREATE INDEX IF NOT EXISTS properties_chain ON properties(sourced_entity_id, predicate);
CREATE INDEX IF NOT EXISTS properties_lookup ON properties(predicate, value_id, cached_period_to);
CREATE INDEX IF NOT EXISTS properties_entity ON properties(cached_entity_id, predicate);
CREATE INDEX IF NOT EXISTS properties_object ON properties(cached_object_entity_id, predicate);
CREATE INDEX IF NOT EXISTS properties_agent ON properties(cached_agent_entity_id, predicate);
CREATE INDEX IF NOT EXISTS properties_originator ON properties(originator_action_id);
CREATE INDEX IF NOT EXISTS properties_closer ON properties(closing_action_id);
-- The few runs whose value is a location value, by that value.
CREATE INDEX IF NOT EXISTS properties_location ON properties(value_location_id)
  WHERE value_location_id IS NOT NULL;

-- Metric streams (observations-exempt; routed by the ontology metric:true flag).
-- Temporal semantics: value at T = latest reading <= T.
CREATE TABLE IF NOT EXISTS metrics (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sourced_entity_id  INTEGER NOT NULL REFERENCES sourced_entities(id),
  cached_entity_id   INTEGER NOT NULL REFERENCES entities(id),
  predicate          TEXT NOT NULL,
  action_id          INTEGER NOT NULL REFERENCES actions(id),
  value              REAL NOT NULL,
  valid_at           INTEGER NOT NULL,
  observed_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS metrics_dedupe
  ON metrics(sourced_entity_id, predicate, action_id, value);
CREATE INDEX IF NOT EXISTS metrics_series ON metrics(cached_entity_id, predicate, valid_at);

-- Full-text index over each entity's CURRENT text (a rebuildable cache; rowid =
-- entity id). Tiers: elected name / own literal text / direct association names
-- — weighted at query time via bm25().
CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(name, content_text, association_text);
`;

/**
 * Names of all derived tables — everything rebuildable from the log — in a
 * children-before-parents order safe to DELETE FROM with foreign keys ON.
 * `meta` is deliberately absent (the archive's identity is not derived).
 */
export const DERIVED_TABLES = [
  'observations',
  'properties',
  'metrics',
  'entity_fts',
  'action_role_edges', // references actions + sourced_entities + entities → wipe first
  'encounters', // references actions + entities → wipe before both
  'actions',
  'sourced_entities',
  'entity_types',
  'vals',
  'location_values', // references entities → wipe before entities
  'entities',
] as const;

export function applySchema(sqlite: SqliteDriver): void {
  sqlite.exec(SCHEMA_DDL);
  applyDebugViews(sqlite); // read-only conveniences; not part of the schema mirror
  dropLegacyAssertionsSource(sqlite); // after the views: a view naming the column blocks the drop
  createStatisticsTables(sqlite);
}

/**
 * The query planner's statistics tables, empty. A writer's close fills them
 * (`PRAGMA optimize`); creating them here keeps that from being a schema
 * change, so only applying the schema ever changes it.
 */
function createStatisticsTables(sqlite: SqliteDriver): void {
  if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'").get()) return;
  sqlite.exec('ANALYZE sqlite_schema');
}

/**
 * `assertions.source` used to be a denormalized copy of `body.source`. A store
 * folded under that shape still carries the column as NOT NULL, so every insert
 * of the current shape would be refused — and unlike the shape checks in
 * `open.ts`, this one is repairable in place without touching the log's
 * content: the column has no index and no reader, so it is simply dropped.
 * Runs once; a current store has no such column and this is a no-op.
 */
function dropLegacyAssertionsSource(sqlite: SqliteDriver): void {
  const columns = sqlite.prepare('PRAGMA table_info(assertions)').all() as Array<{ name: string }>;
  if (columns.some(c => c.name === 'source')) {
    sqlite.exec('ALTER TABLE assertions DROP COLUMN source');
  }
}

/**
 * Bump when any ops table changes shape. The queue tables are disposable, so
 * a mismatch wipes and recreates them; `sync_state` and `connections` (this
 * replica's identity and its apps' credentials) are never wiped — an
 * incompatible shape there is refused, like the graph's.
 */
export const OPS_SCHEMA_VERSION = 1;

/** The ops tables a version mismatch may drop and recreate. */
export const OPS_DISPOSABLE_TABLES = ['inbox', 'receipts', 'blob_cache'] as const;

/**
 * DDL for the ops sidecar (`persistence.ops.db`). Mirrors `opsSchema.ts`
 * one-to-one. Kept out of the graph file so that the graph is a pure function
 * of the assertion set and a queue append never contends with a fold for the
 * same file's write lock.
 */
export const OPS_DDL = `
-- Pairing + versioning: archive_id (the graph this sidecar belongs to).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Replication cursors + identity (bus_url, account_id, replica_id, token,
-- pull_seq, push_cursor, the device keypair). Never wiped.
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Blob-cache bookkeeping: pins and last access for the fetch-through
-- attachment store. pinned=1 marks a locally minted blob the relay has not yet
-- confirmed holding (unevictable); accessed_at (ms) is the LRU eviction key.
CREATE TABLE IF NOT EXISTS blob_cache (
  cid          TEXT PRIMARY KEY,
  pinned       INTEGER NOT NULL DEFAULT 0,
  accessed_at  INTEGER NOT NULL
);

-- Direct-source connections: the credential a local app is issued to
-- stream events into this replica's inbox. Only the sha256 hex of the bearer
-- token is stored. Revocation keeps the row (revoked_at set) so receipts keep
-- their provenance. Never wiped.
CREATE TABLE IF NOT EXISTS connections (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  token_hash         TEXT NOT NULL UNIQUE,
  kind               TEXT NOT NULL DEFAULT 'app',  -- 'app' (bearer token) | 'loopback' (this machine's own CLI; no token)
  created_at         INTEGER NOT NULL,
  revoked_at         INTEGER,
  last_delivered_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_active_name ON connections(name) WHERE revoked_at IS NULL;

-- The inbox: a QUEUE of loose claims waiting to be folded. A row is deleted
-- when its claim is delivered or dead-lettered and its outcome moves to
-- receipts, so a folded payload exists in one place only: the assertion log.
-- The drain takes rows lane by lane (0 interactive, 1 bulk import) and
-- round-robin across appenders (appender_pid, else the connection) within a
-- lane. cid / outcome / attachments are the drain's recorded intent — the
-- promotion gate's verdict, written BEFORE the archive write, so a crash
-- between the two replays to the same verdict and counts stay exact.
CREATE TABLE IF NOT EXISTS inbox (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id  TEXT NOT NULL REFERENCES connections(id),
  client_id      TEXT NOT NULL,
  payload        TEXT NOT NULL,
  received_at    INTEGER NOT NULL,
  lane           INTEGER NOT NULL DEFAULT 0,
  appender_pid   INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 0,
  cid            TEXT,
  outcome        TEXT,                              -- 'new' | 'duplicate', set with cid
  attachments    TEXT                               -- JSON IngestedAttachment[], set with cid
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_connection_client ON inbox(connection_id, client_id);
CREATE INDEX IF NOT EXISTS inbox_lane_order ON inbox(lane, id);

-- Delivery receipts: what became of a claim once it left the queue. The one
-- read-back a write-only connection has. Deleted when the appender acks them
-- or by an age sweep; a rejected receipt keeps the payload for the tray.
CREATE TABLE IF NOT EXISTS receipts (
  connection_id  TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  appender_pid   INTEGER,
  status         TEXT NOT NULL,                     -- 'delivered' | 'rejected'
  outcome        TEXT,                              -- 'new' | 'duplicate' (delivered)
  cid            TEXT,
  reason         TEXT,
  attachments    TEXT,                              -- JSON IngestedAttachment[] (delivered)
  payload        TEXT,                              -- the rejected body (rejected)
  settled_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS receipts_connection_client ON receipts(connection_id, client_id);
CREATE INDEX IF NOT EXISTS receipts_appender ON receipts(connection_id, appender_pid);
CREATE INDEX IF NOT EXISTS receipts_settled ON receipts(settled_at);
`;

export function applyOpsSchema(sqlite: SqliteDriver): void {
  sqlite.exec(OPS_DDL);
}
