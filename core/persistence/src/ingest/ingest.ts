import { ActionAndChildrenSchema } from '@chronicle.app/schema';
import type { Db } from '../db/open.js';
import type { Tx } from '../db/driver.js';
import { runImmediate } from '../db/retry.js';
import { sql } from '../db/sql.js';
import type { BlobStore } from '../blob/BlobStore.js';
import {
  extractEntityIdentities,
  generateKeysetCID,
  isSyntheticAction,
  SELF_REF,
  syntheticActionKeyset,
} from '../cid/cid.js';
import { generateAssertionBodyCID, generateClaimCID } from '../cid/assertionCid.js';
import { getPredicateAnnotation } from '../annotations/ontology.js';
import { readAssertionKind, type AssertionKind } from '../assertionKind.js';
import { actionAssertedAt, formatInstant } from '../time.js';
import { extractAttachments } from './attachments.js';
import type { ContentReader } from './attachments.js';
import { ValidationError } from './errors.js';

export { ValidationError } from './errors.js';

export interface IngestedAttachment {
  cid: string;
  sizeBytes: number;
  mimeType: string | null;
  /** false when the attachment row was already present (deduped bytes). */
  isNew: boolean;
}

export interface IngestResult {
  cid: string;
  /** false when the CID was already present (idempotent re-ingest). */
  isNew: boolean;
  /** Attachments carried by this payload as contentData (often empty). */
  attachments: IngestedAttachment[];
  /**
   * Non-fatal authoring problems, e.g. a bare literal on an entity-ranged
   * predicate (dropped by the fold, never minted into a synthetic handle).
   */
  diagnostics: string[];
}

/**
 * The log columns that are a pure, deterministic function of an assertion body —
 * `kind`, `asserted_at`, `claim_cid`, and `target_key` — plus the body's
 * `source`, which the keyset derivation below needs and which is read back off
 * the stored body rather than lifted onto a column of its own. Recomputed
 * identically at ingest (from the post-attachment-rewrite body) and at
 * replication receive (from the canonical wire body), so a replica never trusts
 * wire-supplied columns. Attachment rewriting only touches
 * `contentData`/`contentPath` nodes, never the `@key` fields the keyset derives
 * from, so the body passed here can be pre- or post-rewrite with the same result.
 *
 * `claimCid` is the body minus its root `@assertedAt` — an assert and all its
 * confirms share it. A `confirm` body carries no action, so its `target_key` is
 * `null` and its `claim_cid` is the claim it names (`body.claim`), not a hash of
 * its own bytes — that is what lets the fold's confirmation join find the claim.
 *
 * `assertedAt` is `undefined` only for a body that carries no `@assertedAt` at
 * all. Local ingest never sees that case — it materializes an implicit-now stamp
 * into the body first (below) — but replication receive does: an unstamped wire
 * body is rejected there, never silently stamped, because a receiver must not
 * invent a witness time the author never recorded.
 */
export function deriveAssertionColumns(body: Record<string, unknown>): {
  kind: AssertionKind;
  source: string;
  assertedAt: number | undefined;
  claimCid: string;
  targetKey: string | null;
} {
  const kind = readAssertionKind(body);
  const source = String(body.source ?? '');
  // A confirm names an existing claim and projects into no action of its own:
  // its claim_cid IS the referenced claim, and it has no target_key.
  if (kind === 'confirm') {
    return {
      kind,
      source,
      assertedAt: actionAssertedAt(body),
      claimCid: String(body.claim ?? ''),
      targetKey: null,
    };
  }
  // A synthetic action carries no source-native `@key`; its identity is derived
  // from (type + resolved participants). Computed identically here and at shred,
  // so `assertions.target_key` stays equal to `actions.key`. A real action's target
  // key is its primary identity's content key — the hash of its `@key` keyset,
  // or a pre-derived `@id` supplied directly (same keyspace).
  const targetKey = isSyntheticAction(body)
    ? generateKeysetCID(syntheticActionKeyset(body, source))
    : extractEntityIdentities(body, source)[0].key;
  return {
    kind,
    source,
    assertedAt: actionAssertedAt(body),
    claimCid: generateClaimCID(body),
    targetKey,
  };
}

function isEntityNode(v: unknown): boolean {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)['@type'] === 'string'
  );
}

/**
 * Bare literals on entity-ranged predicates are dropped by the fold (minting a
 * `{name}` keyset would be a synthetic handle and would merge every same-named
 * string across all sources). Surface them at ingest instead of silently.
 */
function collectDiagnostics(node: Record<string, unknown>, path: string, out: string[]): void {
  for (const [key, raw] of Object.entries(node)) {
    if (key.startsWith('@')) continue;
    const items = Array.isArray(raw) ? raw : [raw];
    const ann = getPredicateAnnotation(key);
    for (const item of items) {
      if (isEntityNode(item)) {
        collectDiagnostics(item as Record<string, unknown>, `${path}${key}.`, out);
      } else if (
        ann?.isEntityRange &&
        item !== null &&
        item !== undefined &&
        !(key === 'sameAs' && item === SELF_REF)
        // `sameAs: ['@me']` is the reserved self-reference token the identity
        // machinery consumes (SELF_REF) — not a bare literal, never dropped.
      ) {
        out.push(
          `${path}${key}: bare literal ${JSON.stringify(item)} on entity-ranged predicate — dropped (author an entity node with @key)`
        );
      }
    }
  }
}

export interface IngestOptions {
  ingestedAt?: number;
  blobs?: BlobStore;
  readFile?: ContentReader;
}

/** What the promotion gate decides for a prepared claim, read without writing. */
export interface IngestVerdict {
  /** The assertion the claim becomes: the assert's cid, or a minted confirm's. */
  cid: string;
  /** False when that assertion is already present. */
  isNew: boolean;
  attachments: IngestedAttachment[];
}

/**
 * A claim taken through everything that precedes the log append — normalized,
 * validated, stamped, its attachment bytes moved to the blob store, its CID
 * minted — and ready to commit. `verdict()` answers what the gate WILL decide
 * without writing; `commit()` applies it in one immediate transaction. The
 * split lets the inbox drain record the verdict in the ops sidecar before the
 * graph write, so a crash between the two replays to the same outcome.
 */
export interface PreparedIngest {
  cid: string;
  kind: AssertionKind;
  diagnostics: string[];
  verdict(): IngestVerdict;
  commit(): IngestResult;
}

/** The gate's decision, computed the same way outside and inside the transaction. */
type Reader = Pick<Db, 'get'>;

/**
 * Layer 1, prepared: validate a JSON-LD action payload, mint its content CID,
 * and stage everything the log append needs. Validation is structural only
 * and never consults DB state.
 *
 * The observed axis is total: every stored assertion is dated. When the source
 * material carries its own vintage the payload authors `@assertedAt` (an
 * archive's creation date, a message's own timestamp); a live observation that
 * carries none is stamped *now*, materialized into the body before hashing so
 * even "now" is content — hashed, replicated, byte-identical on every device.
 * Occurrence fields (`timestamp`/`startTime`/`endTime`) are never borrowed for
 * this: they are *when the thing happened*, a different axis from *when it was
 * witnessed*, and conflating them backdates a live-crawl sighting onto the valid
 * dimension (a 2019 like seen in a 2026 crawl was asserted in 2026).
 *
 * The one rewrite ingest performs: entity nodes carrying binary content — a
 * `contentData` data URI or a `contentPath` local file — have their bytes
 * moved to the blob store and the node rewritten to reference `attachmentCid`
 * — the canonical body never contains raw bytes or machine-local paths.
 * The rewrite is deterministic (same bytes → same CID → same canonical body),
 * so idempotency on the event CID is preserved. Blobs are written BEFORE the
 * event is appended: an appended event must never reference a missing blob,
 * while a blob without an event is a harmless orphan that heals on retry.
 */
export async function prepareIngest(
  db: Db,
  payload: unknown,
  opts: IngestOptions = {}
): Promise<PreparedIngest> {
  // Normalize to pure JSON before anything reads the payload. In-process
  // callers (e.g. the store loader) hand over live objects whose values may be
  // Dates or other toJSON-able instances; the canonicalizer would render those
  // as `{}` (no enumerable keys) and bake the loss into the immutable log.
  // The round-trip applies exactly JSON semantics, so in-process and piped
  // ingestion of the same extraction produce byte-identical canonical bodies
  // — and therefore identical event CIDs.
  payload = JSON.parse(JSON.stringify(payload)) as unknown;
  const root = payload as Record<string, unknown>;

  // Kind is a body marker, read before validation: a `confirm` has its own tiny
  // shape (claim CID + a new observed stamp, nothing else) and skips the action
  // schema and attachment handling entirely. `assert`/`restated` validate below.
  let kind: AssertionKind;
  try {
    kind = readAssertionKind(root);
  } catch (error) {
    throw new ValidationError('Assertion carries an unrecognized @kind marker', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (kind === 'confirm') return prepareConfirm(db, root, opts);

  // A synthetic action has no source-native `@key` (its identity is derived from
  // type + participants), but the structural schema requires one. Validate
  // against a throwaway copy carrying a stub key — never the real body, so the
  // event CID and stored payload stay clean.
  const synthetic = isSyntheticAction(root);
  const toValidate = synthetic ? { ...root, '@key': ['@type'] } : root;
  const parsed = ActionAndChildrenSchema.safeParse(toValidate);
  if (!parsed.success) {
    throw new ValidationError('Event failed structural validation', parsed.error.issues);
  }

  // The observed axis is total. If the payload carries no `@assertedAt`, stamp
  // *now* into the root before hashing — a live observation is dated at the
  // moment it was witnessed, and materializing it makes "now" content (part of
  // the CID) rather than a machine-local column. Consequence: a truly timeless
  // payload re-ingested is a *new sighting* (fresh now → fresh CID), which is
  // exactly what re-running a live crawl means; an explicitly-stamped payload
  // stays idempotent on its CID. Occurrence fields are never consulted here.
  const now = opts.ingestedAt ?? Date.now();
  const diagnostics: string[] = [];
  if (actionAssertedAt(root) === undefined) {
    // Transition diagnostic: a payload carrying an occurrence but no `@assertedAt`
    // is almost always an un-swept event-native record (its occurrence IS its
    // sighting) rather than a genuinely timeless live observation. It will be
    // sighted implicit-now here — correct for a live crawl, a silent back-dating
    // bug for an event stream. The ETL `ChronicleTransformer` stamps event
    // payloads automatically; a payload reaching ingest without one bypassed it.
    const occ = root.timestamp ?? root.startTime ?? root.endTime;
    if (occ !== undefined && occ !== null) {
      diagnostics.push(
        `root carries an occurrence (${JSON.stringify(occ)}) but no @assertedAt — sighted implicit-now; if this is an event-native record, stamp @assertedAt to its occurrence`
      );
    }
    root['@assertedAt'] = formatInstant(now);
  }
  const assertedAt = actionAssertedAt(root)!;

  collectDiagnostics(root, '', diagnostics);

  const { body, attachments } = await extractAttachments(root, {
    readFile: opts.readFile,
  });
  if (attachments.length > 0 && !opts.blobs) {
    throw new ValidationError('Payload carries binary content but no blob store is configured', {
      cids: attachments.map(a => a.cid),
    });
  }

  const { cid, canonicalBody } = generateAssertionBodyCID(body);
  // Identity derivation can reject the root here (a bare `@id` that disagrees
  // with its `@key` keyset — the cheap integrity check). The Zod refinement
  // above already caught a node carrying neither, so this is the both-present
  // mismatch; surface it as a ValidationError like every other authoring fault.
  let targetKey: string | null;
  let claimCid: string;
  try {
    ({ targetKey, claimCid } = deriveAssertionColumns(body));
  } catch (error) {
    throw new ValidationError('Event identity could not be derived from its body', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const ingestedAt = now;

  for (const a of attachments) await opts.blobs!.put(a.cid, a.bytes, a.mimeType);

  // The three-way gate, as a pure read: (1) this exact assertion is present →
  // no-op; (2) the claim is known under another assertion → a `confirm` is
  // minted (an unchanged re-crawl costs ~a hundred bytes per record instead
  // of a copy; a confirm carries no attachments — the original assert holds
  // this claim's blobs); (3) a new claim → the full assertion.
  const decide = (
    reader: Reader
  ): { resultCid: string; isNew: boolean; confirm?: { cid: string; body: string } } => {
    const existing = reader.get(sql`SELECT cid FROM assertions WHERE cid = ${cid}`);
    if (existing) return { resultCid: cid, isNew: false };
    const priorClaim = reader.get(
      sql`SELECT cid FROM assertions WHERE claim_cid = ${claimCid} AND kind <> 'confirm'`
    );
    if (priorClaim) {
      const confirmBody = {
        '@kind': 'confirm',
        claim: claimCid,
        '@assertedAt': root['@assertedAt'],
      };
      const { cid: confirmCid, canonicalBody: confirmCanonical } =
        generateAssertionBodyCID(confirmBody);
      const confirmExisting = reader.get(sql`SELECT cid FROM assertions WHERE cid = ${confirmCid}`);
      return {
        resultCid: confirmCid,
        isNew: !confirmExisting,
        confirm: { cid: confirmCid, body: confirmCanonical },
      };
    }
    return { resultCid: cid, isNew: true };
  };

  // Attachment metadata is keyed to the assert CID. Runs on the duplicate path
  // too: heals a missing metadata row and keeps the first observer's
  // first_observed_assertion_cid (conflict = no-op).
  const healAttachments = (tx: Tx): IngestedAttachment[] =>
    attachments.map(a => {
      const inserted = tx.run(sql`
        INSERT INTO attachments (cid, size_bytes, mime_type, first_observed_assertion_cid, ingested_at)
        VALUES (${a.cid}, ${a.bytes.byteLength}, ${a.mimeType}, ${cid}, ${ingestedAt})
        ON CONFLICT DO NOTHING
      `);
      return {
        cid: a.cid,
        sizeBytes: a.bytes.byteLength,
        mimeType: a.mimeType,
        isNew: inserted.changes > 0,
      };
    });

  const attachmentVerdict = (reader: Reader, confirm: boolean): IngestedAttachment[] =>
    confirm
      ? []
      : attachments.map(a => ({
          cid: a.cid,
          sizeBytes: a.bytes.byteLength,
          mimeType: a.mimeType,
          isNew: reader.get(sql`SELECT cid FROM attachments WHERE cid = ${a.cid}`) === undefined,
        }));

  return {
    cid,
    kind,
    diagnostics,
    verdict() {
      const decided = decide(db);
      return {
        cid: decided.resultCid,
        isNew: decided.isNew,
        attachments: attachmentVerdict(db, decided.confirm !== undefined),
      };
    },
    commit() {
      // `runImmediate`: read-then-write — see foldAssertions.
      const result = runImmediate(db, tx => {
        const decided = decide(tx);
        if (decided.confirm) {
          if (decided.isNew) {
            tx.run(sql`
              INSERT INTO assertions (cid, kind, claim_cid, target_key, asserted_at, ingested_at)
              VALUES (${decided.confirm.cid}, 'confirm', ${claimCid}, NULL, ${assertedAt}, ${ingestedAt})
            `);
            tx.run(sql`
              INSERT INTO assertion_payloads (cid, body)
              VALUES (${decided.confirm.cid}, ${decided.confirm.body})
            `);
          }
          return { resultCid: decided.resultCid, isNew: decided.isNew, ingested: [] };
        }
        if (decided.isNew) {
          tx.run(sql`
            INSERT INTO assertions (cid, kind, claim_cid, target_key, asserted_at, ingested_at)
            VALUES (${cid}, ${kind}, ${claimCid}, ${targetKey}, ${assertedAt}, ${ingestedAt})
          `);
          tx.run(sql`INSERT INTO assertion_payloads (cid, body) VALUES (${cid}, ${canonicalBody})`);
        }
        return { resultCid: cid, isNew: decided.isNew, ingested: healAttachments(tx) };
      });
      return {
        cid: result.resultCid,
        isNew: result.isNew,
        attachments: result.ingested,
        diagnostics,
      };
    },
  };
}

/**
 * Layer 1: validate a JSON-LD action payload, mint its content CID, and append
 * it to the log — {@link prepareIngest} followed by its commit.
 */
export async function ingest(
  db: Db,
  payload: unknown,
  opts: IngestOptions = {}
): Promise<IngestResult> {
  const prepared = await prepareIngest(db, payload, opts);
  return prepared.commit();
}

/**
 * Prepare a `confirm`: a re-observation of a known claim. Its body is a claim CID
 * plus a new observed stamp, nothing else — no action, so it skips the action
 * schema, carries no attachments, and stores NULL `target_key` (resolved through
 * `claim_cid` at fold time). Idempotent on its own CID like any Assertion.
 */
function prepareConfirm(
  db: Db,
  root: Record<string, unknown>,
  opts: IngestOptions
): PreparedIngest {
  const { claim } = root;
  if (typeof claim !== 'string' || claim.length === 0) {
    throw new ValidationError('A confirm body must carry a `claim` CID string', {
      claim: claim ?? null,
    });
  }
  const now = opts.ingestedAt ?? Date.now();
  if (actionAssertedAt(root) === undefined) root['@assertedAt'] = formatInstant(now);
  const assertedAt = actionAssertedAt(root)!;

  const { cid, canonicalBody } = generateAssertionBodyCID(root);
  const { targetKey, claimCid } = deriveAssertionColumns(root);
  const exists = (reader: Reader): boolean =>
    reader.get(sql`SELECT cid FROM assertions WHERE cid = ${cid}`) !== undefined;

  return {
    cid,
    kind: 'confirm',
    diagnostics: [],
    verdict: () => ({ cid, isNew: !exists(db), attachments: [] }),
    commit() {
      const isNew = runImmediate(db, tx => {
        if (exists(tx)) return false;
        tx.run(sql`
          INSERT INTO assertions (cid, kind, claim_cid, target_key, asserted_at, ingested_at)
          VALUES (${cid}, 'confirm', ${claimCid}, ${targetKey}, ${assertedAt}, ${now})
        `);
        tx.run(sql`INSERT INTO assertion_payloads (cid, body) VALUES (${cid}, ${canonicalBody})`);
        return true;
        // `runImmediate`: read-then-write — see foldAssertions.
      });
      return { cid, isNew, attachments: [], diagnostics: [] };
    },
  };
}
