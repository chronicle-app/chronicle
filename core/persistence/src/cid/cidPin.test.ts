import { describe, expect, it } from 'vitest';
import { generateAssertionBodyCID } from './assertionCid.js';
import { base32Sha256, valueKey } from './canonical.js';
import {
  generateActionDedupeCID,
  generateEntityCID,
  generateKeysetCID,
  generateSourcedEntityCID,
} from './cid.js';
import { attachmentCidOf } from '../blob/BlobStore.js';

/**
 * Identity-function pin. Every string below was generated with the ORIGINAL
 * `node:crypto` sha256 implementation and is hard-coded so the log's content
 * addresses cannot drift. When the hasher is swapped for a portable one
 * (`@noble/hashes`), these must stay byte-for-byte identical — an event CID,
 * value key, keyset key, or attachment CID that moves silently re-keys the
 * whole store and breaks dedupe/merge across every existing archive.
 *
 * Do NOT regenerate these to make a failing test pass. A diff here means the
 * hash output changed, which is exactly the regression this file exists to
 * catch.
 */
describe('CID / content-key pins (identity must not drift)', () => {
  describe('event body CIDs (JSON codec)', () => {
    const cases: Array<{ body: Record<string, unknown>; cid: string; canonical: string }> = [
      {
        body: {
          '@type': 'ReadAction',
          source: 'goodreads',
          sourceId: 'r1',
          timestamp: '2019-01-02T00:00:00Z',
        },
        cid: 'bagaaieracn5yhrgdujrd6zoak5zmpnzlerxxttow6k2ts2sxdqiqp6ulnobq',
        canonical:
          '{"@type":"ReadAction","source":"goodreads","sourceId":"r1","timestamp":"2019-01-02T00:00:00Z"}',
      },
      {
        body: {
          '@type': 'Person',
          source: 'slack',
          handle: 'U0ABC',
          name: 'Ada',
          nested: { b: 2, a: 1 },
        },
        cid: 'bagaaierazeu55p5q7gjlt5thl7dhybzjxatgx5dyppxmctnj6jbiiol2x5gq',
        canonical:
          '{"@type":"Person","handle":"U0ABC","name":"Ada","nested":{"a":1,"b":2},"source":"slack"}',
      },
      {
        body: { z: 1, a: [3, 2, 1], m: { y: 'yes', x: null } },
        cid: 'bagaaieraf6bypr52dc32lmeyqg3fz6me6yfs6le5dpwxp6uvgmakz7e5zshq',
        canonical: '{"a":[3,2,1],"m":{"x":null,"y":"yes"},"z":1}',
      },
    ];
    for (const { body, cid, canonical } of cases) {
      it(`${JSON.stringify(body)}`, () => {
        const out = generateAssertionBodyCID(body);
        expect(out.cid).toBe(cid);
        expect(out.canonicalBody).toBe(canonical);
      });
    }

    it('is invariant under key permutation (idempotent re-import)', () => {
      const a = generateAssertionBodyCID({ a: 1, b: 2, c: 3 });
      const b = generateAssertionBodyCID({ c: 3, b: 2, a: 1 });
      expect(a.cid).toBe(b.cid);
    });
  });

  describe('literal value keys (base32 sha256 of canonical JSON)', () => {
    const cases: Array<{ value: unknown; key: string }> = [
      { value: 'hello', key: 'lktwflryh65xe6xty6rw2skauw4micuysrjnemcpzfmp6pzvjz5a' },
      { value: 42, key: 'ondvznakk2hi3kfaixhnceatpykz7cikytniqo3lc7ogkgz2qbeq' },
      { value: true, key: 'ww7kig3mmi7xycprx4snzlsy5ovtydg5scwzm26ehjc3isdh4evq' },
      { value: null, key: ' absence' },
      { value: { a: 1, b: 2 }, key: 'imsyz73yh7tqg3mkimbt7ayk37da5qbxhashgveky5blrcbje53q' },
      { value: [1, 2, 3], key: 'uyk65lxcdxsrphpaqdpiymcszdnjaejyibv2ohbyyaziix35kt2a' },
      {
        value: 'https://example.com/x',
        key: 'toqdpki35a3d3csnvih2ggbik67ivy5qb3ckhdu2o5toca74omca',
      },
    ];
    for (const { value, key } of cases) {
      it(`${JSON.stringify(value)}`, () => {
        expect(valueKey(value)).toBe(key);
      });
    }
  });

  describe('base32Sha256 (raw bytes)', () => {
    it('"abc"', () => {
      expect(base32Sha256(new TextEncoder().encode('abc'))).toBe(
        'xj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'
      );
    });
    it('empty', () => {
      expect(base32Sha256(new Uint8Array())).toBe(
        '4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'
      );
    });
  });

  describe('keyset / entity content keys', () => {
    it('generateKeysetCID + generateActionDedupeCID share the encoding', () => {
      const keyset = { source: 'goodreads', sourceId: '12345' };
      expect(generateKeysetCID(keyset)).toBe(
        '3ui7iw46snxiprenycrnfjzgoxnpeqxnu44ys3w4zb63gmuvlojq'
      );
      expect(generateActionDedupeCID(keyset)).toBe(
        '3ui7iw46snxiprenycrnfjzgoxnpeqxnu44ys3w4zb63gmuvlojq'
      );
    });
    it('url keyset', () => {
      expect(generateKeysetCID({ url: 'https://example.com/book/1' })).toBe(
        'p3zegpyhg2pplvlnfnyfac7si3ier3pqcnfkgs7xk44q6qy2x4ca'
      );
    });
    it('self-hub keyset', () => {
      expect(generateKeysetCID({ '@type': 'Person', source: 'chronicle', handle: 'myself' })).toBe(
        'emdi7rdijuj2vgwznpyc7hvyvdziqqtrf2funqbf2suyuzo2zsua'
      );
    });
    it('generateEntityCID', () => {
      expect(generateEntityCID('Person', { source: 'slack', handle: 'U0ABC' })).toBe(
        'r3r3zsgw3ffq5h2up4b5ohy2c6xszvj64obl7wjltkikjtljloza'
      );
    });
    it('generateSourcedEntityCID (drops @key)', () => {
      expect(generateSourcedEntityCID({ '@key': ['source'], source: 'x', id: '7' })).toBe(
        '7yd3sbihdp4lyev7g2g3wmvyu35efn32d7htej4pid7qej5cdoiq'
      );
    });
  });

  describe('attachment CIDs (CIDv1, raw codec, sha256)', () => {
    it('PNG magic bytes', () => {
      expect(
        attachmentCidOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ).toBe('bafkreicmjnvdxyjrjk4gcof66qyu3xqcfzqasygyncnczd4gggac2ig2wy');
    });
    it('"hello world"', () => {
      expect(attachmentCidOf(new TextEncoder().encode('hello world'))).toBe(
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
      );
    });
    it('empty', () => {
      expect(attachmentCidOf(new Uint8Array())).toBe(
        'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
      );
    });
  });
});
