/**
 * Structured fold tracing. An opt-in observer over a payload's journey through
 * the persistence pipeline — ingest gate → shred → chain recompute → special
 * recompute → election → FTS. The sink is a plain callback threaded through
 * `FoldOptions`/`FoldContext`; when unset every `ctx.trace()` call is a no-op,
 * so the instrumentation lives permanently in the hot path at zero cost.
 *
 * Events are a tagged union discriminated on `phase` (and, within shred, on
 * `step`). A consumer (the CLI `--trace` printer, or a test) renders or asserts
 * on them; nothing here formats. Emission is synchronous and inside the fold
 * transaction, so a sink must only read/format — never touch the db.
 */

/** How the ingest gate classified a payload as it entered the log. */
export type IngestGate =
  | 'new' // a fresh assert/restated CID landed
  | 'duplicate' // the CID was already present (idempotent re-ingest)
  | 'confirm'; // an unchanged re-sighting minted a tiny confirm

export type FoldTrace =
  // Layer 1 — the payload's entry verdict, emitted from `process.ts` once the
  // ingest gate has run (before the fold proper).
  | {
      phase: 'ingest';
      cid: string;
      kind: string; // 'assert' | 'restated' | 'confirm'
      source: string;
      targetKey: string | null;
      gate: IngestGate;
    }
  // Shred — one payload cracked into observation rows + dictionaries.
  | { phase: 'shred'; step: 'start'; cid: string; kind: string }
  // A confirm re-dates recency without minting rows: report its fan-out.
  | {
      phase: 'shred';
      step: 'confirm-fanout';
      cid: string;
      chains: number; // ordinary chains re-dated
      specials: number; // special (action-derived) chains re-dated
      anchors: number; // anchored actions whose observed axis was reconciled
    }
  // A sourced entity resolved (and its backing entity id).
  | {
      phase: 'shred';
      step: 'entity';
      entityId: number;
      source: string;
      type: string;
      key: string; // primary keyset hash
      merged: boolean;
    }
  // An in-event merge collapsed entities onto a survivor.
  | {
      phase: 'shred';
      step: 'merge';
      survivor: number;
      losers: number[];
      referrers: number[];
    }
  // The action row this payload founds/restates.
  | {
      phase: 'shred';
      step: 'action';
      actionType: string;
      key: string;
      agent: number | null; // agent sourced id
      object: number | null; // object sourced id
    }
  // A observation landed (row actually inserted, not a dedupe no-op).
  | {
      phase: 'shred';
      step: 'observe';
      subject: number; // subject sourced id
      predicate: string;
      validAt: number;
      observedAt: number;
    }
  // A special (action-derived) chain marked dirty for recompute.
  | {
      phase: 'shred';
      step: 'special-dirty';
      object: number; // object sourced id
      predicate: string;
      agent: number | null; // agent sourced id
    }
  // Chain recompute — the run-derivation path taken for one dirty ordinary chain.
  | {
      phase: 'chain';
      subject: number; // subject sourced id
      predicate: string;
      path: 'unchanged' | 'fast' | 'full';
      newRows: number; // observation rows this batch added to the chain
      confirms: number; // confirm times bearing on the chain
      invalidated: boolean; // an anchor register narrowing forced the full path
    }
  // Special chain recompute (one object/predicate/agent triple).
  | {
      phase: 'special';
      object: number;
      predicate: string;
      agent: number | null;
    }
  // Entity name election — `hop` marks a cross-entity re-election triggered by
  // a neighbour's name change rather than the entity's own touch.
  | {
      phase: 'elect';
      entityId: number;
      name: string | null;
      changed: boolean;
      hop: boolean;
    }
  // FTS row refreshed for an entity.
  | { phase: 'fts'; entityId: number };

/** A trace observer. Called synchronously inside the fold transaction. */
export type FoldTraceSink = (event: FoldTrace) => void;
