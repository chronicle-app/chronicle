import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { BaseAndChildrenSchema } from '../../../core/schema/dist/index.js';
import { readSchema } from '../src/lib/model.js';
import { validateRecords } from '../src/lib/validate.js';
import { buildSite } from './build.js';
import { DATA_DIRECTORIES } from './directories.js';

const schema = await readSchema(DATA_DIRECTORIES.schema);

test('every documentation example is a valid Chronicle record', () => {
  assert.ok(schema.examples.length > 0);
  // Chronicle JSON shows dates as ISO strings; plugins emit Date objects.
  const dates = new Set(
    [...schema.properties.values()]
      .filter(property => property.range.includes('DateTime'))
      .map(property => property.name)
  );
  const revive = value =>
    Array.isArray(value)
      ? value.map(item => revive(item))
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              dates.has(key) ? new Date(item) : revive(item),
            ])
          )
        : value;
  for (const example of schema.examples) {
    const record = revive(example.chronicle);
    const result = BaseAndChildrenSchema.safeParse(record);
    assert.ok(result.success, `${example.id}: ${result.error?.message}`);
    // Zod strips undeclared fields, so a lossless parse means every field is declared.
    assert.deepEqual(result.data, record, `${example.id} uses fields its types do not declare`);
    assert.ok(example.usedBy.length > 0, `${example.id} is not linked from any term`);
  }
});

test('the validator accepts every example, in Chronicle JSON and JSON-LD', () => {
  for (const example of schema.examples) {
    for (const value of [example.chronicle, example.jsonld]) {
      const result = validateRecords(JSON.stringify(value), BaseAndChildrenSchema);
      assert.equal(result.status, 'valid', `${example.id}: ${JSON.stringify(result.errors)}`);
      assert.deepEqual(result.warnings, [], example.id);
    }
  }
});

test('the built site has a page for every term and no broken links', async () => {
  const output = mkdtempSync(join(tmpdir(), 'chronicle-schema-site-'));
  try {
    await buildSite({ output });
    for (const name of schema.classes.keys()) {
      assert.ok(existsSync(join(output, 'classes', `${name}.html`)), name);
    }
    for (const name of schema.properties.keys()) {
      assert.ok(existsSync(join(output, 'properties', `${name}.html`)), name);
    }
    const pages = readdirSync(output, { recursive: true }).filter(file => file.endsWith('.html'));
    for (const page of pages) {
      const html = readFileSync(join(output, page), 'utf8');
      // Browsers end a link at the first link inside it.
      let depth = 0;
      for (const [tag] of html.matchAll(/<\/?a\b/g)) {
        depth += tag === '<a' ? 1 : -1;
        assert.ok(depth <= 1, `${page} has a link inside a link`);
      }
      const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
      for (const [, reference] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(reference)) continue;
        const [path, fragment] = reference.split('#');
        if (!path) {
          assert.ok(ids.has(fragment), `${page}: missing #${fragment}`);
          continue;
        }
        const target = path.startsWith('/')
          ? join(output, path)
          : resolve(dirname(join(output, page)), path);
        assert.ok(existsSync(target), `${page} links to missing ${reference}`);
      }
    }
    assert.ok(existsSync(join(output, 'chronicle.ttl')));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
