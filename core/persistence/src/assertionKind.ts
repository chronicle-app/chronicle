/**
 * Assertion kinds — which speech-act an Assertion is. The kind is a **body-level
 * marker inside the hashed bytes** (the same pattern as `@synthetic`), so the CID
 * pins it and sync carries it for free.
 * If kind rode outside the hash, one CID could circulate under two kinds and
 * folding would depend on arrival order.
 *
 * - `assert` — testimony: a Source reporting what it saw. The common case, so it
 *   is the ABSENCE of a marker (no `@kind`), keeping ordinary payloads clean.
 * - `restated` — the store re-expressing its own derived state as ingestible
 *   content; the unit of scoped export.
 * - `confirm` — a re-observation of a known claim: body is a claim CID + a new
 *   observed stamp, nothing else.
 */
export type AssertionKind = 'assert' | 'restated' | 'confirm';

export const ASSERTION_KINDS: readonly AssertionKind[] = ['assert', 'restated', 'confirm'];

/**
 * The kind rank in the fold's total order `(effective time, kind rank, content
 * hash)`: `assert` outranks `restated`, so when a restated Assertion honestly
 * ties its original at the same true time, the original wins deterministically —
 * a re-import never repoints founding or anchors.
 * `confirm` never competes in an election (it mints no observation rows), but is
 * ranked last for completeness. Lower rank wins.
 */
export const KIND_RANK: Record<AssertionKind, number> = { assert: 0, restated: 1, confirm: 2 };

/**
 * The kind a body declares. Derived from body content (the `@kind` marker),
 * never trusted off the wire — recomputed at ingest and at replication receive
 * exactly like `source`/`asserted_at`/`target_key`. Absent marker → `assert`.
 * A marker present but unrecognized is an authoring fault the caller surfaces.
 */
export function readAssertionKind(body: Record<string, unknown>): AssertionKind {
  const marker = body['@kind'];
  if (marker === undefined) return 'assert';
  if (marker === 'restated' || marker === 'confirm') return marker;
  throw new Error(`Unknown assertion @kind marker: ${JSON.stringify(marker)}`);
}
