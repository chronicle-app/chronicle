import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * The ops sidecar (`persistence.ops.db`): the machinery around one archive,
 * kept out of the graph file. Everything here is a position, a queue, or a
 * credential relative to ONE archive — a cursor into its log, rows waiting to
 * be folded into it, tokens that let an app write to it — so the file is
 * paired to that archive by `archive_id` (see {@link meta}) and lives beside
 * it. None of it is hashed, replicated, or a function of the assertion set,
 * and none of it survives into a backup of the archive: copying the graph
 * file alone yields a valid archive with no queue, no cursors, no tokens.
 *
 * The queue tables (`inbox`, `receipts`, `blob_cache`) are disposable — a
 * schema revision wipes and recreates them. `sync_state` and `connections`
 * carry this replica's identity and its apps' credentials and are never
 * wiped: an incompatible revision is refused, like the graph's.
 */

/** Pairing + versioning: `archive_id` (the graph it belongs to), `schema_version`. */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * Local-only sync bookkeeping: replication cursors + identity (bus_url,
 * account_id, replica_id, token, pull_seq, push_cursor, the device keypair).
 */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value'),
});

/**
 * Local blob-cache bookkeeping for the fetch-through attachment store:
 * bytes live in the {@link BlobStore}; this tracks pins (a locally minted blob
 * the relay has not confirmed holding — unevictable) and last access (the LRU
 * eviction key).
 */
export const blobCache = sqliteTable('blob_cache', {
  cid: text('cid').primaryKey(),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  accessedAt: integer('accessed_at').notNull(),
});

/**
 * Direct-source connections: the credential a local app is issued to
 * stream events into this replica's inbox. Write-only — a connection token
 * reaches the inbox routes and nothing else. Only the sha256 hex of the bearer
 * token is stored; revocation sets `revoked_at` and keeps the row so receipts
 * keep their provenance.
 */
export const connections = sqliteTable(
  'connections',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /**
     * `app`: a connected local app holding a bearer token. `loopback`: this
     * machine's own front-ends (the CLI) appending directly — no token, hidden
     * from the Sources catalog.
     */
    kind: text('kind').notNull().default('app'),
    createdAt: integer('created_at').notNull(),
    revokedAt: integer('revoked_at'),
    lastDeliveredAt: integer('last_delivered_at'),
  },
  table => [
    uniqueIndex('connections_active_name')
      .on(table.name)
      .where(sql`revoked_at IS NULL`),
  ]
);

/**
 * The inbox: a QUEUE of loose claims waiting for the host to fold them, and
 * nothing more — a row is deleted the moment its claim is delivered or
 * dead-lettered, and its outcome moves to {@link receipts}. The payload
 * therefore exists in exactly one place once folded: the assertion log.
 *
 * `(connection_id, client_id)` is the app-chosen idempotency key. The drain
 * takes rows lane by lane (0 interactive, 1 bulk import) and round-robin
 * across appenders within a lane. `cid` / `outcome` / `attachments` are the
 * drain's recorded INTENT: what the promotion gate decided for this row,
 * written before the archive write, so a crash between the two replays to the
 * same verdict and the appender's counts stay exact.
 */
export const inbox = sqliteTable(
  'inbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id),
    clientId: text('client_id').notNull(),
    payload: text('payload').notNull(),
    receivedAt: integer('received_at').notNull(),
    lane: integer('lane').notNull().default(0),
    appenderPid: integer('appender_pid'),
    attempts: integer('attempts').notNull().default(0),
    /** The assertion this row becomes (decided before the archive write). */
    cid: text('cid'),
    /** `new` | `duplicate`, decided with `cid`. */
    outcome: text('outcome'),
    /** JSON `IngestedAttachment[]`, decided with `cid`. */
    attachments: text('attachments'),
  },
  table => [
    uniqueIndex('inbox_connection_client').on(table.connectionId, table.clientId),
    index('inbox_lane_order').on(table.lane, table.id),
  ]
);

/**
 * Delivery receipts: what became of a claim once it left the queue —
 * `delivered` (with the cid it became and whether it was new) or `rejected`
 * (with the reason, and the payload so the "tray" can show what was sent).
 * The only read-back a write-only connection has. Receipts are deleted when
 * the appender acknowledges them, or by an age sweep for ones nobody claims.
 */
export const receipts = sqliteTable(
  'receipts',
  {
    connectionId: text('connection_id').notNull(),
    clientId: text('client_id').notNull(),
    appenderPid: integer('appender_pid'),
    /** delivered | rejected */
    status: text('status').notNull(),
    /** new | duplicate (delivered only) */
    outcome: text('outcome'),
    cid: text('cid'),
    reason: text('reason'),
    /** JSON `IngestedAttachment[]` (delivered only). */
    attachments: text('attachments'),
    /** The rejected claim's body, for the tray (rejected only). */
    payload: text('payload'),
    settledAt: integer('settled_at').notNull(),
  },
  table => [
    uniqueIndex('receipts_connection_client').on(table.connectionId, table.clientId),
    index('receipts_appender').on(table.connectionId, table.appenderPid),
    index('receipts_settled').on(table.settledAt),
  ]
);
