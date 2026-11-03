import { describe, expect, it } from 'vitest';
import { Base64Error, decodeBase64 } from './base64.js';

const enc = (s: string) => Buffer.from(s).toString('base64');
const bytes = (s: string) => new TextEncoder().encode(s);

describe('decodeBase64', () => {
  it('round-trips against Node Buffer for varied lengths (all padding shapes)', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'hello', 'hello world', 'x'.repeat(100)]) {
      expect(decodeBase64(enc(s))).toEqual(bytes(s));
    }
  });

  it('decodes binary bytes covering the full alphabet', () => {
    const raw = new Uint8Array(256);
    for (let i = 0; i < 256; i++) raw[i] = i;
    const b64 = Buffer.from(raw).toString('base64');
    expect(decodeBase64(b64)).toEqual(raw);
  });

  it('rejects length not a multiple of 4', () => {
    expect(() => decodeBase64('abc')).toThrow(Base64Error);
  });

  it('rejects characters outside the standard alphabet', () => {
    expect(() => decodeBase64('ab*d')).toThrow(Base64Error);
    // URL-safe alphabet is not accepted.
    expect(() => decodeBase64('ab-d')).toThrow(Base64Error);
    expect(() => decodeBase64('ab_d')).toThrow(Base64Error);
  });

  it('rejects misplaced padding', () => {
    expect(() => decodeBase64('a=bc')).toThrow(Base64Error);
    expect(() => decodeBase64('=abc')).toThrow(Base64Error);
    expect(() => decodeBase64('ab=c')).toThrow(Base64Error);
    // '=' before the last group.
    expect(() => decodeBase64('a===')).toThrow(Base64Error);
  });

  it('rejects non-ASCII input', () => {
    expect(() => decodeBase64('abÿd')).toThrow(Base64Error);
  });
});
