import { describe, expect, it } from 'vitest';
import { parsePayloadStream } from './parse.js';

describe('parsePayloadStream', () => {
  it('parses a single object', () => {
    expect(parsePayloadStream('{"a":1}')).toEqual([{ a: 1 }]);
  });

  it('flattens a JSON array', () => {
    expect(parsePayloadStream('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('parses JSONL', () => {
    expect(parsePayloadStream('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('parses concatenated pretty-printed objects (plugin output)', () => {
    const text = `{
  "@type": "ExecuteAction",
  "object": { "body": "echo hi" }
}
{
  "@type": "ExecuteAction",
  "object": { "body": "ls" }
}
`;
    const out = parsePayloadStream(text) as Array<{ object: { body: string } }>;
    expect(out).toHaveLength(2);
    expect(out[1].object.body).toBe('ls');
  });

  it('is string- and escape-aware (braces inside strings)', () => {
    const text = '{"body":"git commit -m \\"fix: {}[]\\""}{"body":"ls"}';
    const out = parsePayloadStream(text) as Array<{ body: string }>;
    expect(out).toHaveLength(2);
    expect(out[0].body).toBe('git commit -m "fix: {}[]"');
    expect(out[1].body).toBe('ls');
  });

  it('returns [] for empty input', () => {
    expect(parsePayloadStream('   \n ')).toEqual([]);
  });
});
