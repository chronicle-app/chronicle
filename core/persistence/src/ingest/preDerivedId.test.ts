import { describe, expect, it } from 'vitest';
import { extractEntityIdentities } from '../cid/cid.js';
import { makeTestDb } from '../testing/testDb.js';
import { assertPermutationInvariant, projectToSnapshot } from '../testing/permutation.js';
import { processEvent } from '../process.js';
import { ingest, ValidationError } from './ingest.js';

// Rewrite a `@key`-authored payload into the equivalent pre-derived `@id` form:
// every identity-bearing node drops `@key` and instead carries `@id` = the
// content key its keyset would hash to. Everything else (properties, edges,
// nested nodes, structural fields like sourceId) is preserved verbatim, so the
// only thing that changes is HOW identity is spelled — not the identity itself.
// Value nodes (no `@key`) are left untouched.
function toIdForm(node: unknown, inheritedSource: string, rootBody: Record<string, unknown>): any {
  if (Array.isArray(node)) return node.map(n => toIdForm(n, inheritedSource, rootBody));
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const source = typeof obj.source === 'string' ? obj.source : inheritedSource;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '@key') continue;
    out[k] = typeof v === 'object' && v !== null ? toIdForm(v, source, rootBody) : v;
  }
  if (Array.isArray(obj['@key'])) {
    out['@id'] = extractEntityIdentities(obj, source, rootBody)[0].key;
  }
  return out;
}

const agent = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};

// Event-native: @assertedAt = timestamp (the fold reads the sighting axis only
// from @assertedAt; an unstamped payload would be dated implicit-now).
const read = (over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent,
  '@key': ['source', 'sourceId'],
  ...(over.timestamp === undefined ? {} : { '@assertedAt': over.timestamp }),
  ...over,
});

const book = (over: Record<string, unknown>) => ({
  '@type': 'Book',
  source: 'test',
  sourceId: 'book-1',
  '@key': ['source', 'sourceId'],
  ...over,
});

// A corpus exercising nested entities, edges, and a cross-source sameAs merge.
const corpus = (): Record<string, unknown>[] => [
  read({
    sourceId: 'r1',
    timestamp: '2023-01-01T00:00:00Z',
    object: book({
      name: '1984',
      author: [
        {
          '@type': 'Person',
          source: 'test',
          sourceId: 'orwell',
          '@key': ['source', 'sourceId'],
          name: 'George Orwell',
        },
      ],
    }),
  }),
  read({
    sourceId: 'r2',
    timestamp: '2023-02-01T00:00:00Z',
    object: book({
      name: 'Nineteen Eighty-Four',
      sameAs: [
        {
          '@type': 'Book',
          source: 'goodreads',
          sourceId: 'gr-1984',
          '@key': ['source', 'sourceId'],
        },
      ],
    }),
  }),
];

// The @key and @id spellings of a record are DIFFERENT wire bytes, so they hash
// to different assertion CIDs — legitimate provenance divergence, not an identity
// difference. The equivalence claim is over identity resolution + derived state,
// so compare snapshots with the assertion-provenance fields stripped (the only
// preimage/wire-dependent fields the snapshot carries; all other columns are
// content-keyed and must match bit-for-bit).
function foldedState(snapshot: string): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(item => strip(item));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === 'assertion' || k === 'foundingAssertionCid') continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(strip(JSON.parse(snapshot)));
}

async function foldedStateOf(events: unknown[]): Promise<string> {
  return foldedState(await projectToSnapshot(events));
}

describe('pre-derived @id ≡ @key (fold equivalence)', () => {
  it('folds to identical identity + derived state whether authored via @key or @id', async () => {
    const keyForm = corpus();
    const idForm = keyForm.map(p => toIdForm(p, String(p.source), p));

    expect(await foldedStateOf(idForm)).toBe(await foldedStateOf(keyForm));
  });

  it('converges @key and @id spellings of the same records onto one state, any order', async () => {
    // Both spellings of every record in one corpus: the @id form shares each
    // node's content key with the @key form, so they dedup onto identical
    // entities/actions regardless of arrival order.
    const keyForm = corpus();
    const idForm = keyForm.map(p => toIdForm(p, String(p.source), p));
    await assertPermutationInvariant([...keyForm, ...idForm]);
  });

  it('drives the same cross-source merge from an @id-only sameAs ref', async () => {
    // The @key form carries a preimage sameAs ref; the @id form carries the same
    // ref as a bare hash. Both must merge the Goodreads identity into the book —
    // i.e. resolve to one entity with the goodreads keyset among its keysets.
    const keyForm = corpus();
    const idForm = keyForm.map(p => toIdForm(p, String(p.source), p));
    expect(await foldedStateOf(idForm)).toBe(await foldedStateOf(keyForm));
  });

  it('accepts the content-IRI @id form identically to the bare hash', async () => {
    const keyForm = corpus();
    const bareId = keyForm.map(p => toIdForm(p, String(p.source), p));
    const iriId = bareId.map(function wrap(node: any): any {
      if (Array.isArray(node)) return node.map(n => wrap(n));
      if (!node || typeof node !== 'object') return node;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === '@id' && typeof v === 'string') {
          const kind =
            node['@type'] && String(node['@type']).endsWith('Action') ? 'action' : 'entity';
          out[k] = `<https://data.chronicle.app/${kind}/${v}>`;
        } else {
          out[k] = typeof v === 'object' && v !== null ? wrap(v) : v;
        }
      }
      return out;
    });

    expect(await foldedStateOf(iriId)).toBe(await foldedStateOf(bareId));
  });
});

describe('the identity invariant — fail-fast at ingest', () => {
  it('rejects a root action carrying neither @key nor @id (ValidationError)', async () => {
    const { db, close } = makeTestDb();
    try {
      await expect(
        ingest(db, {
          '@type': 'ReadAction',
          source: 'test',
          sourceId: 'r1',
          timestamp: '2023-01-01T00:00:00Z',
          agent,
        })
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      close();
    }
  });

  it('rejects a nested entity carrying neither @key nor @id (ValidationError, not at fold)', async () => {
    const { db, close } = makeTestDb();
    try {
      await expect(
        ingest(
          db,
          read({
            sourceId: 'r1',
            timestamp: '2023-01-01T00:00:00Z',
            object: { '@type': 'Book', source: 'test', name: 'unkeyed' },
          })
        )
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      close();
    }
  });

  it('rejects a root whose @key and @id disagree (ValidationError)', async () => {
    const { db, close } = makeTestDb();
    try {
      await expect(
        ingest(db, {
          '@type': 'ReadAction',
          source: 'test',
          sourceId: 'r1',
          timestamp: '2023-01-01T00:00:00Z',
          agent,
          '@key': ['source', 'sourceId'],
          '@id': 'deliberatelywrong',
        })
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      close();
    }
  });

  it('still admits an @id-only action end-to-end', async () => {
    const { db, close } = makeTestDb();
    try {
      const { key } = extractEntityIdentities(
        { '@type': 'ReadAction', source: 'test', sourceId: 'r1', '@key': ['source', 'sourceId'] },
        'test'
      )[0];
      const result = await processEvent(db, {
        '@type': 'ReadAction',
        source: 'test',
        '@id': key,
        timestamp: '2023-01-01T00:00:00Z',
        agent,
        object: book({ name: '1984' }),
      });
      expect(result.isNew).toBe(true);
    } finally {
      close();
    }
  });
});
