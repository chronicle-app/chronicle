import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import { EmailMboxExtractor } from '../dist/index.js';
import { fixture, keyed, keyless } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  const input = fixture(t, [keyed, keyless]);
  const samples = [];
  // Without the mailbox's address, and with it.
  for (const config of [{}, { account: 'bob@example.test' }]) {
    samples.push(
      ...(await sampleTransform(new EmailMboxExtractor({ input, quiet: true, ...config })))
    );
  }
  const rendered = renderShapes(shapesOf(samples), { title: 'Email' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
