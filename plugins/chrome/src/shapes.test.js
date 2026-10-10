import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import { ChromeExtractor } from '../dist/index.js';
import { fixture } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  const samples = [];
  // A signed-in profile, and a signed-out one.
  for (const prefs of [undefined, null]) {
    const { input } = fixture(t, { prefs });
    samples.push(...(await sampleTransform(new ChromeExtractor({ input }))));
  }
  const rendered = renderShapes(shapesOf(samples), { title: 'Chrome' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
