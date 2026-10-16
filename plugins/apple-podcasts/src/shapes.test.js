import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import { ApplePodcastsExtractor } from '../dist/index.js';
import { account, writeApplePodcastsFixture } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'apple-podcasts-shapes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = writeApplePodcastsFixture(dir);
  const samples = await sampleTransform(new ApplePodcastsExtractor({ input, account, limit: 0 }));
  const rendered = renderShapes(shapesOf(samples), { title: 'Apple Podcasts' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
