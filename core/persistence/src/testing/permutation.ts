import { processEvent, processEvents } from '../process.js';
import { rebuildDerived } from '../fold/fold.js';
import { serializeSnapshot } from '../serialize/snapshot.js';
import { generateClaimCID } from '../cid/assertionCid.js';
import { makeTestDb } from './testDb.js';
import { mulberry32, shuffle, subSeed } from './rng.js';

/**
 * The single observed stamp every injected `confirm` carries — strictly after
 * every worked-example sighting, so a confirm always advances its claim's
 * `last_confirmed` observed axis (never a vacuous no-op) and the "did it move"
 * check has an unambiguous target.
 */
export const CONFIRM_AT = '2099-01-01T00:00:00.000Z';

/**
 * Augment an event set with the two derived Assertion kinds the log mints in
 * practice, so the permutation contract covers them alongside plain asserts. For
 * every top-level assert we append:
 *
 *  - a **restated** twin — the same claim, re-expressed by the store (the unit of
 *    scoped export). It ties the assert at the assert's own `@assertedAt`, so the
 *    fold's kind rank — not arrival order — must keep the assert as the run and
 *    action founding; it folds to a duplicate observation row and nothing else.
 *  - a **confirm** — a later re-sighting of the assert's claim. Its `claim` is the
 *    assert's claim CID, computed exactly as ingest does (order-independent, root
 *    `@assertedAt` stripped), so it resolves at fold time and advances only the
 *    run's `last_confirmed` observed axis (decision A), and only for an
 *    `assert`-sourced claim (decision B — the restated twin's own claim is inert).
 *
 * Echoes are appended, never interleaved: the permutation harness reshuffles the
 * whole set anyway, so ingest order is exercised regardless.
 */
export function withEchoes(events: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const raw of events) {
    out.push(raw);
    const ev = raw as Record<string, unknown>;
    // Only echo genuine asserts. The base sets are all asserts; guard anyway so
    // an already-augmented set is never doubly echoed, and a confirm (which owns
    // no claim of its own to re-quote) is skipped.
    if (ev['@kind'] !== undefined) continue;
    out.push({ ...ev, '@kind': 'restated' });
    if (typeof ev['@assertedAt'] !== 'string') continue;
    out.push({
      '@kind': 'confirm',
      source: ev.source ?? 'test',
      claim: generateClaimCID(ev),
      '@assertedAt': CONFIRM_AT,
    });
  }
  return out;
}

export interface PermutationConfig {
  /** master seed for reproducible runs (default 1) */
  seed?: number;
  /** number of random orderings to try (default 50) */
  orders?: number;
  /** fraction of events randomly re-injected as duplicates (default 0.3) */
  duplicateRate?: number;
  /**
   * probability of dropping derived state and replaying the whole log after an
   * event (default 0.1) — interleaves incremental and full-rebuild maintenance
   */
  rebuildRate?: number;
}

/** Fold an event set into a fresh in-memory DB and snapshot the derived state. */
export async function projectToSnapshot(events: unknown[]): Promise<string> {
  const { db, close } = makeTestDb();
  try {
    await processEvents(db, events);
    return serializeSnapshot(db);
  } finally {
    close();
  }
}

function injectDuplicates(seq: unknown[], rng: () => number, rate: number): unknown[] {
  const out: unknown[] = [];
  for (const e of seq) {
    out.push(e);
    if (rng() < rate && out.length > 0) {
      out.push(out[Math.floor(rng() * out.length)]);
    }
  }
  return out;
}

function firstDiff(a: string, b: string): string {
  const al = a.split('\n');
  const bl = b.split('\n');
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      return `line ${i + 1}:\n  reference: ${JSON.stringify(al[i])}\n  permuted:  ${JSON.stringify(bl[i])}`;
    }
  }
  return '(no line-level difference found)';
}

/**
 * The verification contract: every projection is a deterministic function of
 * the event SET. Apply the events in N seeded random orders, each with random
 * duplicate injection, randomly disabled fast path, and randomly interleaved
 * full-log replays — and assert the canonical JSON snapshot is byte-identical
 * to the reference (the events as given, folded as one batch). The fast path
 * and the diff reconciler are exactly the code event-order permutation alone
 * would not exercise. Returns the reference snapshot.
 */
export async function assertPermutationInvariant(
  events: unknown[],
  config: PermutationConfig = {}
): Promise<string> {
  const { seed = 1, orders = 50, duplicateRate = 0.3, rebuildRate = 0.1 } = config;
  const reference = await projectToSnapshot(events);

  for (let k = 1; k <= orders; k++) {
    const rng = mulberry32(subSeed(seed, k));
    const ordered = shuffle(events, rng);
    const withDupes = injectDuplicates(ordered, rng, duplicateRate);

    const { db, close } = makeTestDb();
    let got: string;
    try {
      for (const event of withDupes) {
        await processEvent(db, event, { fastPath: rng() < 0.5 });
        if (rng() < rebuildRate) rebuildDerived(db, { fastPath: rng() < 0.5 });
      }
      got = serializeSnapshot(db);
    } finally {
      close();
    }

    if (got !== reference) {
      throw new Error(
        `Permutation invariant violated (seed=${seed}, order=${k}).\n` +
          `${firstDiff(reference, got)}\n\n--- reference ---\n${reference}\n--- permuted ---\n${got}`
      );
    }
  }
  return reference;
}
