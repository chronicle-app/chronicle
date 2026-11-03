import { describe, expect, it } from 'vitest';
import {
  CONFIRM_AT,
  assertPermutationInvariant,
  projectToSnapshot,
  withEchoes,
} from './permutation.js';
import { workedExamples } from './examples.js';

// These are exhaustive property tests — every worked example folded across dozens
// of shuffles, with duplicates and interleaved fast/full maintenance, and (below)
// restated/confirm echoes injected. Runtime scales with examples × orders and the
// per-fold work; the default 5s is too tight for the combined variants on the
// slower CI runner, so the heavy ones get a generous ceiling.
const PERMUTATION_TIMEOUT_MS = 30_000;

describe('permutation invariant (the verification contract)', () => {
  for (const [name, events] of Object.entries(workedExamples)) {
    it(
      `${name}: identical snapshot across 50 orders + duplicates + interleaved maintenance`,
      async () => {
        await expect(
          assertPermutationInvariant(events, {
            seed: 7,
            orders: 50,
            duplicateRate: 0.4,
          })
        ).resolves.toBeTypeOf('string');
      },
      PERMUTATION_TIMEOUT_MS
    );
  }

  it(
    'combined set (all examples together) is order-independent',
    async () => {
      const all = Object.values(workedExamples).flat();
      await assertPermutationInvariant(all, { seed: 42, orders: 30 });
    },
    PERMUTATION_TIMEOUT_MS
  );
});

// The contract: restated Assertions and confirms are ordinary members of
// the event SET, so the projection is still a deterministic function of it. Each
// echoed set carries, per assert, a same-time `restated` twin and a later
// `confirm` — the fold must land byte-identical state under any ingest order,
// exercising the kind-ranked founding election and the confirm recency path.
describe('permutation invariant with confirms + restated', () => {
  for (const [name, events] of Object.entries(workedExamples)) {
    it(
      `${name} + echoes: identical snapshot across 50 orders + duplicates + interleaved maintenance`,
      async () => {
        await expect(
          assertPermutationInvariant(withEchoes(events), {
            seed: 11,
            orders: 50,
            duplicateRate: 0.4,
          })
        ).resolves.toBeTypeOf('string');
      },
      PERMUTATION_TIMEOUT_MS
    );
  }

  it(
    'combined echoed set (all examples together) is order-independent',
    async () => {
      const all = withEchoes(Object.values(workedExamples).flat());
      await assertPermutationInvariant(all, { seed: 43, orders: 30 });
    },
    PERMUTATION_TIMEOUT_MS
  );

  // Guard against a vacuous pass: the echoes must actually MOVE derived state, in
  // the directions decisions A/B specify. An `assert`-sourced confirm advances a
  // run's observed axis to the confirm stamp while pinning its valid axis and
  // founding action (A) — for an observation-backed run (`name`, reached via
  // claim_cid; confirmFolding covers an action-derived special run). The
  // restated twin loses the founding tie (never repoints founding) and folds to
  // a duplicate observations row.
  it('confirms advance every run observed-only; restated keeps founding', async () => {
    const base = JSON.parse(await projectToSnapshot(workedExamples.supersession)) as Snapshot;
    const echoed = JSON.parse(
      await projectToSnapshot(withEchoes(workedExamples.supersession))
    ) as Snapshot;

    const confirmAt = Date.parse(CONFIRM_AT);
    const key = (p: Prop) => `${p.subject}|${p.predicate}|${JSON.stringify(p.value)}`;
    const baseByKey = new Map(base.properties.map(p => [key(p), p]));
    expect(base.properties.length).toBeGreaterThan(0);
    expect(echoed.properties).toHaveLength(base.properties.length);

    // Every run — the book's `name` (observations) — advances its observed axis
    // to the confirm and nothing else.
    const predicates = new Set(echoed.properties.map(p => p.predicate));
    expect(predicates).toContain('name');
    for (const ep of echoed.properties) {
      const bp = baseByKey.get(key(ep));
      expect(bp, `run ${key(ep)} present in both`).toBeDefined();
      expect(ep.last.observedAt).toBe(confirmAt); // A: observed axis advances
      expect(ep.last.validAt).toBe(bp!.last.validAt); // valid axis pinned
      expect(ep.last.action).toBe(bp!.last.action); // founding action pinned
      expect(ep.first).toEqual(bp!.first); // first_observed untouched
    }

    // restated twins fold to real (duplicate-value) observations rows, and the founding
    // election keeps every action pinned to its assert.
    expect(echoed.observations.length).toBeGreaterThan(base.observations.length);
    expect(Object.keys(echoed.actions).sort()).toEqual(Object.keys(base.actions).sort());
    for (const k of Object.keys(base.actions)) {
      expect((echoed.actions[k] as ActionShape).foundingAssertionCid).toBe(
        (base.actions[k] as ActionShape).foundingAssertionCid
      );
    }
  });
});

interface Anchor {
  validAt: number;
  observedAt: number;
  action: string | null;
}
interface Prop {
  subject: string;
  predicate: string;
  value: unknown;
  first: Anchor;
  last: Anchor;
}
interface ActionShape {
  foundingAssertionCid: string;
}
interface Snapshot {
  properties: Prop[];
  observations: unknown[];
  actions: Record<string, unknown>;
}

describe('WE-3 membership timelines', () => {
  it('anchors placement to the assertion time and keeps timelines open', async () => {
    const snapshot = JSON.parse(await projectToSnapshot(workedExamples.lateMembership)) as {
      properties: Array<{
        predicate: string;
        first: { validAt: number; observedAt: number };
        periodFrom: number | null;
        periodTo: number | null;
      }>;
    };
    const members = snapshot.properties.filter(p => p.predicate === 'member');
    expect(members).toHaveLength(3);

    // Carol's membership: asserted 2024-03-01; placement mirrors the sighting.
    const carol = members.find(m => m.first.observedAt === Date.parse('2024-03-01T00:00:00Z'))!;
    expect(carol.first.validAt).toBe(Date.parse('2024-03-01T00:00:00Z'));
    // the timeline-initial run has an unknown start and is open
    expect(carol.periodFrom).toBeNull();
    expect(carol.periodTo).toBeNull();
  });
});
