// @chronicle.app/persistence — event log + fold + derived validity runs on SQLite.
//
// This is the PORTABLE entry: it must not reach `node:*` or a native SQLite
// binding through any value import, so it runs on Node and on Hermes/Expo
// alike. Node-only store opening + local blob store live in
// `@chronicle.app/persistence/node`; `makeTestDb` in `.../testing`.

export { PERSISTENCE_NAMESPACE, SCHEMA_NAMESPACE } from './constants.js';

// Database (portable: DDL, schema, and the runtime-agnostic driver types).
export {
  applyOpsSchema,
  applySchema,
  DERIVED_TABLES,
  OPS_DDL,
  OPS_DISPOSABLE_TABLES,
  OPS_SCHEMA_VERSION,
  SCHEMA_DDL,
} from './db/migrate.js';
// An assertion's `source` is read off its stored body, never a log column.
export { assertionSourceSql } from './db/assertionSource.js';
export * as schema from './db/schema.js';
// The ops sidecar's tables (inbox queue, receipts, connections, sync state,
// blob pins) — a second file beside the graph; see opsSchema.ts.
export * as opsSchema from './db/opsSchema.js';
export type * from './db/types.js';
export type { Db, OpenResult, OpsDb, OpsTx } from './db/driver.js';
export type { DriverRunResult, DriverStatement, SqliteDriver, Tx } from './db/driver.js';
export type { OpenOptions } from './db/open.js';
// The busy discipline: every write transaction is BEGIN IMMEDIATE with
// full-jitter retry on SQLITE_BUSY (shared by every process on one store).
export { isBusyError, runImmediate, sleepSync, withBusyRetry } from './db/retry.js';
export type { BusyRetryOptions } from './db/retry.js';

// Base64 (strict, portable — no Buffer). Used by attachment ingest and by the
// sync client to decode opaque batch records pulled from the bus.
export { Base64Error, decodeBase64 } from './util/base64.js';

// Content addressing
export {
  extractEntityIdentities,
  generateActionDedupeCID,
  generateEntityCID,
  generateKeysetCID,
  generateSourcedEntityCID,
} from './cid/cid.js';
export type { EntityIdentity } from './cid/cid.js';
export { ABSENCE_KEY, canonicalize, canonicalJson, valueKey } from './cid/canonical.js';
export { generateAssertionBodyCID } from './cid/assertionCid.js';

// Blob storage (attachment bytes; metadata lives in the attachments table).
// LocalBlobStore is Node-only (node:fs) — it lives in the `/node` entry.
export { attachmentCidOf } from './blob/BlobStore.js';
export type { BlobStore } from './blob/BlobStore.js';
export { MemoryBlobStore } from './blob/MemoryBlobStore.js';

// Annotations
export { getAllPredicateAnnotations, getPredicateAnnotation } from './annotations/ontology.js';
export type { PredicateAnnotation } from './annotations/ontology.js';
export {
  GRADE_OBSERVED,
  GRADE_ORIGIN,
  deleteTypeNames,
  getSpecialPropertyDef,
  getSpecialPropertyDefs,
  isDeleteType,
  isOriginResultType,
  isSpecialPredicate,
  specialPredicatesFor,
} from './annotations/actionTypes.js';
export type { SpecialPropertyDef } from './annotations/actionTypes.js';

// Ingest + fold
export { ingest, prepareIngest, ValidationError } from './ingest/ingest.js';
export type {
  IngestOptions,
  IngestResult,
  IngestVerdict,
  IngestedAttachment,
  PreparedIngest,
} from './ingest/ingest.js';
// Pure derivation of the log columns (source / asserted_at / target_key) from an
// event body. Exported for hosts that append events to the log directly — e.g.
// the mobile bootstrap's phase-A raw append, which inserts events + payloads
// without folding, then folds in resumable chunks.
export { deriveAssertionColumns } from './ingest/ingest.js';
export { extractAttachments } from './ingest/attachments.js';
export type {
  ContentReader,
  ExtractAttachmentsOptions,
  ExtractedAttachment,
} from './ingest/attachments.js';
export { parsePayloadStream } from './ingest/parse.js';
export type { InsertedBatchRows } from './ingest/batchRows.js';
export { assertBatchShape } from './ingest/envelope.js';
export type {
  AttachmentMeta,
  AssertionEnvelope,
  AssertionKind,
  SyncBatch,
} from './ingest/envelope.js';
export {
  foldAssertions,
  foldAssertionsInTx,
  rebuildDerived,
  rebuildSpecialProperties,
} from './fold/fold.js';
export type { FoldOptions } from './fold/fold.js';
export type { FoldTrace, FoldTraceSink, IngestGate } from './fold/trace.js';
export {
  DEFAULT_FOLD_BATCH,
  FoldBatcher,
  ingestEvent,
  processEvent,
  processEventBatch,
  processEvents,
} from './process.js';
export type {
  FoldBatcherOptions,
  PayloadOutcome,
  ProcessEventBatchOptions,
  ProcessEventBatchResult,
} from './process.js';
export type { ProcessOptions } from './process.js';
export { serializeSnapshot } from './serialize/snapshot.js';
export { serializeProjection } from './serialize/json.js';
export type { EntityProjection, PropertyFact, ProjectionOptions } from './serialize/json.js';
export type { ActionImageRef } from './serialize/imageRefs.js';

// Query (CQL evaluation against the cache columns)
export {
  queryActionIdsByIds,
  queryEntityActionIds,
  queryEntityBacklinkIds,
} from './query/query.js';
export type {
  ActionsByIdsOptions,
  EntityActionRole,
  EntityActionsOptions,
  EntityBacklinksOptions,
  IdPage,
} from './query/query.js';
export {
  actionHistogram,
  encounterHistogram,
  queryActionIds,
  queryActionPage,
  queryEntityIds,
  queryEntityPage,
  UnsupportedConstraintError,
} from './query/evaluate.js';
export {
  collectSimilarTexts,
  lowerQuery,
  queryCount,
  queryCountBy,
  queryPage,
} from './query/cql.js';
export type { QueryPageOutcome } from './query/cql.js';
export type { SimilarResolutions } from './query/evaluate.js';
export {
  compileActionWhere,
  compileEntityWhere,
  countActions,
  countEntities,
} from './query/evaluate.js';
export type { CompiledWhere } from './query/evaluate.js';
// Aggregation in the store: --count-by over any dimension, and the
// query envelope's summary (total, span, facets, census) over the full set.
export {
  countActionsBy,
  countEntitiesBy,
  parseDimension,
  summarizeActions,
  summarizeEntities,
} from './query/summary.js';
export type { CountBucket, CountByDimension, QuerySummary } from './query/summary.js';
export type {
  ActionQueryOptions,
  ActionQueryPage,
  HistogramBin,
  HistogramBucket,
  QueryOptions,
  QueryPage,
} from './query/evaluate.js';
export type {
  ConstraintNode,
  TemporalModifier,
  TypeConstraint,
  PropertyConstraint,
  AssociationConstraint,
} from '@chronicle.app/cql';

// Time
export { actionAssertedAt, formatInstant, parseInstant } from './time.js';
