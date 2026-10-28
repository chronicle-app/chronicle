import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database, { drizzle } from './nodeSqlite.js';
import type { BlobStore } from '../blob/BlobStore.js';
import { LocalBlobStore } from '../blob/LocalBlobStore.js';
import { MemoryBlobStore } from '../blob/MemoryBlobStore.js';
import {
  applyOpsSchema,
  applySchema,
  OPS_DISPOSABLE_TABLES,
  OPS_SCHEMA_VERSION,
} from './migrate.js';
import type { OpenResult, SqliteDriver } from './driver.js';
import * as schema from './schema.js';
import * as opsSchema from './opsSchema.js';

export type { Db, OpenResult } from './driver.js';

/**
 * Where a graph file's ops sidecar lives: `persistence.db` → `persistence.ops.db`
 * beside it (the runs sidecar's convention), so a `--db` override carries its
 * queue and cursors with it and two throwaway stores in one directory never
 * share a sidecar. `:memory:` pairs with an in-memory sidecar.
 */
export function opsPathFor(dbPath: string): string {
  if (dbPath === ':memory:') return ':memory:';
  const base = basename(dbPath).replace(/\.db$/i, '');
  return join(dirname(dbPath), `${base}.ops.db`);
}

export interface OpenOptions {
  /** File path, or ":memory:" (default). */
  path?: string;
  /** The ops sidecar's path (default {@link opsPathFor} of `path`). */
  opsPath?: string;
  /** Apply the schema DDL on open (default true). */
  migrate?: boolean;
  /**
   * Directory for attachment blobs. Defaults so blob persistence matches
   * database persistence: `<path>.attachments` next to a file-backed database,
   * an in-memory store for `:memory:`. The directory is created lazily on the
   * first attachment write.
   */
  attachmentsDir?: string;
  /**
   * Skip the stale-derived-state refusal (action_role_edges backfill check).
   * Only the rebuild path sets this — it exists to repair exactly that state.
   */
  allowStaleDerived?: boolean;
  /**
   * How long a writer waits for the store's write lock before SQLite reports
   * busy (default 5000 ms). The busy-retry helpers (`runImmediate`) back off
   * and retry on top of this.
   */
  busyTimeoutMs?: number;
  /**
   * Open for reading only: both files must already exist, no DDL runs (neither
   * the schema nor the debug views), the journal mode is left as it is, and
   * SQLite refuses every write on either handle. A reader never takes a write
   * lock, so it never waits on a fold in another process. The schemas are
   * still checked, so a store from an older revision is refused the same way.
   */
  readonly?: boolean;
}

const hasTable = (sqlite: SqliteDriver, name: string): boolean =>
  sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name) !==
  undefined;

const hasColumn = (sqlite: SqliteDriver, table: string, column: string): boolean =>
  sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some(c => (c as { name: string }).name === column);

/**
 * A database created by a pre-revision schema: the legacy property_observations table
 * exists, or `properties` predates the string-predicate / split-value-column
 * shape (it has `predicate_id` instead of `predicate`). There are no
 * migrations in dev — `CREATE TABLE IF NOT EXISTS` would silently leave the
 * old shapes in place and every fold/query would fail on missing columns, so
 * refuse loudly.
 */
function assertCurrentSchema(sqlite: SqliteDriver, path: string): void {
  const legacyJournal = hasTable(sqlite, 'property_observations');
  const propertiesIsCurrent =
    !hasTable(sqlite, 'properties') || hasColumn(sqlite, 'properties', 'predicate');
  // `entities.cached_name` was added after the revision; an older entities table
  // passes the checks above but `CREATE TABLE IF NOT EXISTS` won't add the
  // column, so the fold's `UPDATE entities SET cached_name` fails cryptically
  // mid-ingest. Catch it here instead.
  const entitiesIsCurrent =
    !hasTable(sqlite, 'entities') || hasColumn(sqlite, 'entities', 'cached_name');
  // A url identity now lives in the `url` namespace rather than carrying a NULL
  // source, so `sourced_entities.source` is NOT NULL again. A store folded while
  // it was nullable holds NULL-source rows that the current DDL forbids and that
  // `CREATE TABLE IF NOT EXISTS` will not rewrite, and its url keysets hash the
  // old `{url}` shape — so those entities would never merge with newly minted
  // ones. Detect the data, not the column: a fresh store has neither.
  const sourcedEntitiesIsCurrent =
    !hasTable(sqlite, 'sourced_entities') ||
    (sqlite.prepare('SELECT 1 FROM sourced_entities WHERE source IS NULL LIMIT 1').get() ===
      undefined &&
      hasColumn(sqlite, 'sourced_entities', 'url'));
  // The machinery moved out: a graph file that still carries the inbox, the
  // connections, sync cursors, or blob pins predates the ops sidecar. Its
  // queue and cursors would be invisible to every reader of the sidecar, so
  // it is an older schema like the rest.
  const machineryMovedOut = !['inbox', 'connections', 'sync_state', 'blob_cache'].some(t =>
    hasTable(sqlite, t)
  );
  // Derived state predating action_role_edges: the table is created empty by
  // the DDL, but only the fold populates it — pre-upgrade stores would answer
  // role/attachment queries with silent empties.
  // Unlike the shape checks above, this state IS repairable in place.
  // Fold-synthetic occurrences carry no participant edges by design, so only
  // source-given actions count.
  const roleEdgesStale =
    hasTable(sqlite, 'actions') &&
    sqlite
      .prepare(
        `SELECT 1 FROM actions WHERE (agent_sourced_id IS NOT NULL OR object_sourced_id IS NOT NULL) AND synthetic = 0 LIMIT 1`
      )
      .get() !== undefined &&
    (!hasTable(sqlite, 'action_role_edges') ||
      sqlite.prepare('SELECT 1 FROM action_role_edges LIMIT 1').get() === undefined);
  if (roleEdgesStale) {
    sqlite.close();
    throw new Error(
      `Store at ${path} was folded before participant edges existed (action_role_edges is empty) — run \`chronicle archive rebuild\` (or cdev, for the dev store) to backfill, then retry.`
    );
  }
  if (
    legacyJournal ||
    !propertiesIsCurrent ||
    !entitiesIsCurrent ||
    !sourcedEntitiesIsCurrent ||
    !machineryMovedOut
  ) {
    sqlite.close();
    throw new Error(
      `Store at ${path} was created by an older schema and there are no migrations — delete it and re-ingest from source (derived state is rebuildable; only delete stores whose event log you can recreate).`
    );
  }
}

/**
 * Bring an ops sidecar to the current revision. The queue tables are
 * disposable: on a version mismatch they are dropped and recreated (the
 * appenders re-send; nothing in them is history). `sync_state` and
 * `connections` hold this replica's identity and its apps' credentials and
 * are never dropped — an incompatible shape there is refused.
 */
function prepareOpsSchema(sqlite: SqliteDriver, path: string, readonly: boolean): void {
  const raw = sqlite.pragma('user_version');
  const current =
    (Array.isArray(raw) ? (raw[0] as { user_version?: number })?.user_version : (raw as number)) ??
    0;
  const fresh = !hasTable(sqlite, 'sync_state') && !hasTable(sqlite, 'connections');
  const identityIsCurrent =
    (!hasTable(sqlite, 'connections') || hasColumn(sqlite, 'connections', 'kind')) &&
    (!hasTable(sqlite, 'sync_state') || hasColumn(sqlite, 'sync_state', 'value'));
  if (!identityIsCurrent) {
    sqlite.close();
    throw new Error(
      `Ops sidecar at ${path} was created by an older schema and there are no migrations — delete it (a fresh one needs \`sync setup\` and \`sources connect\` again).`
    );
  }
  if (readonly) {
    if (!fresh && current !== OPS_SCHEMA_VERSION) {
      sqlite.close();
      throw new Error(
        `Ops sidecar at ${path} is on schema v${current} (current v${OPS_SCHEMA_VERSION}); run a writer (an import, or serve) to bring it up to date.`
      );
    }
    return;
  }
  if (!fresh && current !== OPS_SCHEMA_VERSION) {
    for (const table of OPS_DISPOSABLE_TABLES) sqlite.exec(`DROP TABLE IF EXISTS "${table}"`);
  }
  applyOpsSchema(sqlite);
  sqlite.pragma(`user_version = ${OPS_SCHEMA_VERSION}`);
}

const readMeta = (sqlite: SqliteDriver, key: string): string | undefined =>
  hasTable(sqlite, 'meta')
    ? (
        sqlite.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
          { value: string } | undefined
      )?.value
    : undefined;

/**
 * Pair the two files by `archive_id`: the graph mints one on its first
 * read-write open, the sidecar takes the graph's on its first, and from then
 * on a mismatch is refused — a sidecar copied beside a different archive
 * would otherwise hand that archive foreign cursors and a foreign queue.
 */
function pairArchive(
  graph: SqliteDriver,
  ops: SqliteDriver,
  paths: { graph: string; ops: string },
  readonly: boolean
): void {
  let archiveId = readMeta(graph, 'archive_id');
  if (!archiveId && !readonly) {
    archiveId = randomUUID();
    graph.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('archive_id', archiveId);
  }
  const paired = readMeta(ops, 'archive_id');
  if (archiveId && paired && paired !== archiveId) {
    throw new Error(
      `Ops sidecar at ${paths.ops} belongs to a different archive than ${paths.graph} (archive_id ${paired} vs ${archiveId}) — delete the sidecar, or point --db at the archive it was made for.`
    );
  }
  if (archiveId && !paired && !readonly) {
    ops.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('archive_id', archiveId);
  }
}

function openHandle(
  path: string,
  opts: { readonly: boolean; busyTimeoutMs: number }
): Database.Database {
  const sqlite = new Database(path, opts.readonly ? { readonly: true, fileMustExist: true } : {});
  // Readers leave the journal mode alone: setting it is a write, and a store
  // a writer has already put in WAL mode stays there.
  if (!opts.readonly) sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // A sync session can write while the read-API or another CLI process holds
  // the store open. Without a busy timeout a concurrent writer throws
  // SQLITE_BUSY immediately; wait up to 5s for the lock instead.
  sqlite.pragma(`busy_timeout = ${opts.busyTimeoutMs}`);
  return sqlite;
}

/**
 * Open a Chronicle store: the graph (`persistence.db`) and its ops sidecar
 * (`persistence.ops.db`), two SQLite files with one connection each.
 * Synchronous (`node:sqlite`); the whole fold of one event runs inside
 * `db.transaction(...)`.
 *
 * No transaction spans the two files (`ATTACH` under immediate transactions
 * would lock both, defeating the split). Writers that touch both follow one
 * ordering rule instead: the graph write is idempotent and goes first, the
 * ops write (a cursor, a receipt) follows, and where a verdict must be exact
 * it is recorded in ops as intent before the graph write — so a crash between
 * the two always replays to the same state.
 */
export function openDatabase(options: OpenOptions = {}): OpenResult {
  const { path = ':memory:', attachmentsDir, readonly = false } = options;
  const opsPath = options.opsPath ?? opsPathFor(path);
  const migrate = readonly ? false : (options.migrate ?? true);
  const busyTimeoutMs = Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000));
  if (readonly && path !== ':memory:' && !existsSync(path)) {
    throw new Error(
      `No archive yet at ${path} — a reader never creates one; run a writer (an import, or serve) first.`
    );
  }

  const sqlite = openHandle(path, { readonly, busyTimeoutMs });
  if (path !== ':memory:' && options.allowStaleDerived !== true) assertCurrentSchema(sqlite, path);
  if (migrate) applySchema(sqlite);
  if (readonly && opsPath !== ':memory:' && !existsSync(opsPath)) {
    sqlite.close();
    throw new Error(
      `No ops sidecar yet at ${opsPath} — a reader never creates one; run a writer (an import, or serve) first.`
    );
  }

  let opsSqlite: Database.Database;
  try {
    opsSqlite = openHandle(opsPath, { readonly, busyTimeoutMs });
  } catch (error) {
    sqlite.close();
    throw error;
  }
  try {
    prepareOpsSchema(opsSqlite, opsPath, readonly || !migrate);
    if (path !== ':memory:') {
      pairArchive(sqlite, opsSqlite, { graph: path, ops: opsPath }, readonly);
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  const db = drizzle(sqlite, { schema });
  const ops = drizzle(opsSqlite, { schema: opsSchema });
  const blobs: BlobStore =
    path === ':memory:' && !attachmentsDir
      ? new MemoryBlobStore()
      : new LocalBlobStore(attachmentsDir ?? `${path}.attachments`);
  return {
    db,
    sqlite,
    ops,
    opsSqlite,
    blobs,
    close() {
      // Table statistics for the query planner: SQLite analyzes the tables
      // that have none yet or have grown tenfold since, and skips the rest.
      if (!readonly && path !== ':memory:') sqlite.pragma('optimize=0x10002');
      sqlite.close();
      opsSqlite.close();
    },
  };
}
