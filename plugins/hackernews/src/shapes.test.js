import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import {
  HackerNewsCommentsExtractor,
  HackerNewsRepliesExtractor,
  HackerNewsSubmissionsExtractor,
} from '../dist/index.js';
import { USERNAME, fakeHackerNews } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  await fakeHackerNews(t);
  const samples = [];
  for (const Extractor of [
    HackerNewsSubmissionsExtractor,
    HackerNewsCommentsExtractor,
    HackerNewsRepliesExtractor,
  ]) {
    samples.push(...(await sampleTransform(new Extractor({ username: USERNAME }))));
  }
  const rendered = renderShapes(shapesOf(samples), { title: 'Hacker News' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
