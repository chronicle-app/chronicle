import { describe, expect, it } from 'vitest';
import * as json from 'multiformats/codecs/json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { ABSENCE_KEY, canonicalJson, valueKey } from './canonical.js';
import { URL_SOURCE, extractEntityIdentities, generateKeysetCID } from './cid.js';
import { generateAssertionBodyCID } from './assertionCid.js';

// Content keys are bare base32 (RFC4648 lowercase, no padding) of a 256-bit
// sha256 digest — 52 chars over the alphabet a-z2-7.
const BASE32_KEY = /^[a-z2-7]{52}$/;

describe('canonicalization', () => {
  it('is independent of object key order (deep)', () => {
    const a = { x: 1, nested: { b: 2, a: 1 }, y: [3, { q: 1, p: 2 }] };
    const b = { y: [3, { p: 2, q: 1 }], nested: { a: 1, b: 2 }, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order (semantically meaningful)', () => {
    expect(canonicalJson({ v: [1, 2] })).not.toBe(canonicalJson({ v: [2, 1] }));
  });

  it('derives a stable valueKey for scalars and absence', () => {
    // base32 sha256 over the canonical JSON; identical content -> identical key
    expect(valueKey('1984')).toMatch(BASE32_KEY);
    expect(valueKey('1984')).not.toBe(valueKey(1984));
    expect(valueKey(null)).toBe(ABSENCE_KEY);
    // eslint-disable-next-line unicorn/no-useless-undefined -- exercising the undefined path
    expect(valueKey(undefined)).toBe(ABSENCE_KEY);
    expect(valueKey({ b: 2, a: 1 })).toBe(valueKey({ a: 1, b: 2 }));
    // the absence key sorts before every hex key (deterministic orderings)
    expect(ABSENCE_KEY < valueKey('anything')).toBe(true);
  });
});

describe('content key', () => {
  it('is bare base32 sha256 (no CID framing)', () => {
    expect(generateKeysetCID({ source: 'lastfm', handle: 'jdoe' })).toMatch(BASE32_KEY);
  });

  it('produces the same keyset key regardless of key order', () => {
    const a = generateKeysetCID({ source: 'x', sourceId: '1' });
    const b = generateKeysetCID({ sourceId: '1', source: 'x' });
    expect(a).toBe(b);
    expect(a).toMatch(BASE32_KEY);
  });

  it('event-body CID is order-independent and checkable', async () => {
    const p1 = { '@type': 'ReadAction', source: 's', nested: { b: 1, a: 2 } };
    const p2 = { nested: { a: 2, b: 1 }, source: 's', '@type': 'ReadAction' };
    const r1 = await generateAssertionBodyCID(p1);
    const r2 = await generateAssertionBodyCID(p2);
    expect(r1.cid).toBe(r2.cid);

    // sha256 over json.encode(canonical body) reproduces the CID's multihash.
    const bytes = json.encode(JSON.parse(r1.canonicalBody));
    const hash = await sha256.digest(bytes);
    expect(CID.create(1, json.code, hash).toString()).toBe(r1.cid);
  });
});

describe('extractEntityIdentities', () => {
  it('reads @key and always appends a url identity, carrying preimages', () => {
    const identities = extractEntityIdentities(
      {
        '@type': 'Person',
        source: 'spotify',
        handle: 'jdoe',
        url: 'https://open.spotify.com/user/jdoe',
        '@key': ['@type', 'source', 'handle'],
      },
      'spotify'
    );
    expect(identities).toEqual([
      {
        key: generateKeysetCID({ '@type': 'Person', source: 'spotify', handle: 'jdoe' }),
        keyset: { '@type': 'Person', source: 'spotify', handle: 'jdoe' },
      },
      {
        key: generateKeysetCID({ source: URL_SOURCE, url: 'https://open.spotify.com/user/jdoe' }),
        keyset: { source: URL_SOURCE, url: 'https://open.spotify.com/user/jdoe' },
      },
    ]);
  });

  it('appends an attachmentCid identity so identical bytes dedupe', () => {
    const cid = 'bafkreihelloworld';
    const withCid = (type: string, source: string) =>
      extractEntityIdentities(
        { '@type': type, source, attachmentCid: cid, '@key': ['@type', 'source'] },
        source
      );
    const cidKeyOf = (list: ReturnType<typeof withCid>) =>
      list.find(i => i.keyset !== null && 'attachmentCid' in i.keyset)?.key;

    const img = withCid('ImageObject', 'chrome');
    expect(cidKeyOf(img)).toBe(generateKeysetCID({ attachmentCid: cid }));
    // Same bytes, different @type/source → the SAME content-addressed identity.
    expect(cidKeyOf(withCid('DocumentObject', 'safari'))).toBe(cidKeyOf(img));
  });

  it('throws with neither @key nor @id', () => {
    expect(() => extractEntityIdentities({ '@type': 'Person', source: 'x' }, 'x')).toThrow(
      /neither @key nor @id/
    );
  });

  it('throws when every @key field resolves to null/undefined (no empty keyset)', () => {
    // `handle`/`sourceId` are absent, so the keyset would be {} — which would
    // hash to a single shared CID and collapse unrelated records together.
    expect(() =>
      extractEntityIdentities(
        { '@type': 'Person', source: 'x', '@key': ['handle', 'sourceId'] },
        'x'
      )
    ).toThrow(/neither @key nor @id/);
  });

  it('falls back to the url identity as primary when @key fields are all absent', () => {
    const identities = extractEntityIdentities(
      {
        '@type': 'Person',
        source: 'x',
        url: 'https://example.com/jane',
        '@key': ['handle'],
      },
      'x'
    );
    expect(identities).toEqual([
      {
        key: generateKeysetCID({ source: URL_SOURCE, url: 'https://example.com/jane' }),
        keyset: { source: URL_SOURCE, url: 'https://example.com/jane' },
      },
    ]);
  });

  it('normalizes `@key: ["url"]` to the url namespace — one identity, not two', () => {
    const url = 'https://example.com/page';
    const identities = extractEntityIdentities(
      { '@type': 'Entity', source: 'chrome', url, '@key': ['url'] },
      'chrome'
    );
    // The authored key and the auto-minted one are the SAME identity, so a node
    // keyed on nothing but its url mints one row, not a namespaced one beside a
    // chrome-attributed one.
    expect(identities).toEqual([
      { key: generateKeysetCID({ source: URL_SOURCE, url }), keyset: { source: URL_SOURCE, url } },
    ]);
  });

  it('leaves a source-scoped url keyset alone — that is the source’s own record', () => {
    const url = 'https://example.com/page';
    const identities = extractEntityIdentities(
      { '@type': 'Entity', source: 'pinboard', url, '@key': ['url', 'source'] },
      'pinboard'
    );
    // Pinboard's own row, plus the shared url identity it merges through.
    expect(identities).toEqual([
      {
        key: generateKeysetCID({ url, source: 'pinboard' }),
        keyset: { url, source: 'pinboard' },
      },
      { key: generateKeysetCID({ source: URL_SOURCE, url }), keyset: { source: URL_SOURCE, url } },
    ]);
  });

  describe('pre-derived @id', () => {
    const preimage = { '@type': 'Person', source: 'spotify', handle: 'jdoe' };
    const hash = generateKeysetCID(preimage);

    it('accepts a bare @id, storing the hash with a null preimage', () => {
      const identities = extractEntityIdentities({ '@type': 'Person', '@id': hash }, 'spotify');
      expect(identities).toEqual([{ key: hash, keyset: null }]);
    });

    it('resolves to the same key whether authored via @key or @id', () => {
      const viaKey = extractEntityIdentities(
        {
          '@type': 'Person',
          source: 'spotify',
          handle: 'jdoe',
          '@key': ['@type', 'source', 'handle'],
        },
        'spotify'
      );
      const viaId = extractEntityIdentities({ '@type': 'Person', '@id': hash }, 'spotify');
      expect(viaId[0].key).toBe(viaKey[0].key);
    });

    it('accepts the content-IRI form of @id, normalizing to the bare key', () => {
      const iri = `<https://data.chronicle.app/entity/${hash}>`;
      const identities = extractEntityIdentities({ '@type': 'Person', '@id': iri }, 'spotify');
      expect(identities).toEqual([{ key: hash, keyset: null }]);
    });

    it('accepts both @key and @id when they agree, keeping the preimage', () => {
      const identities = extractEntityIdentities(
        {
          '@type': 'Person',
          source: 'spotify',
          handle: 'jdoe',
          '@key': ['@type', 'source', 'handle'],
          '@id': hash,
        },
        'spotify'
      );
      expect(identities).toEqual([{ key: hash, keyset: preimage }]);
    });

    it('throws when @key and @id disagree', () => {
      expect(() =>
        extractEntityIdentities(
          {
            '@type': 'Person',
            source: 'spotify',
            handle: 'jdoe',
            '@key': ['@type', 'source', 'handle'],
            '@id': 'notthehash',
          },
          'spotify'
        )
      ).toThrow(/does not match/);
    });

    it('folds an @id-only sameAs ref in as a merge identity', () => {
      const identities = extractEntityIdentities(
        {
          '@type': 'Person',
          source: 'spotify',
          handle: 'jdoe',
          '@key': ['@type', 'source', 'handle'],
          sameAs: [{ '@type': 'Person', '@id': hash }],
        },
        'spotify'
      );
      expect(identities.map(i => i.key)).toContain(hash);
    });
  });
});

describe('cidOf empty-object guard', () => {
  it('refuses to mint a CID for an empty keyset', () => {
    expect(() => generateKeysetCID({})).toThrow(/empty object/);
  });
});
