import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import {
  AppleNotesEditsExtractor,
  AppleNotesExtractor,
  AppleNotesTransformer,
} from '../dist/index.js';
import { ACCOUNT, lookupContact, writeNotesFixture } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

// The fixture's account and Contacts, never the host's.
const transformer = () => new AppleNotesTransformer({ account: ACCOUNT, lookupContact });

test('SHAPES.md describes what every record type becomes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'apple-notes-shapes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = writeNotesFixture(dir);
  const samples = [
    ...(await sampleTransform(new AppleNotesExtractor({ input, limit: 0 }), transformer())),
    ...(await sampleTransform(new AppleNotesEditsExtractor({ input, limit: 0 }), transformer())),
  ];
  const rendered = renderShapes(shapesOf(samples), { title: 'Apple Notes' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
