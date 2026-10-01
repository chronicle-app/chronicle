import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import {
  GitHubCommentsExtractor,
  GitHubGistsExtractor,
  GitHubIssuesExtractor,
  GitHubPullRequestsExtractor,
  GitHubRepliesExtractor,
  GitHubResolutionsExtractor,
  GitHubStarsExtractor,
} from '../dist/index.js';
import { fakeGitHub } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  await fakeGitHub(t);
  const samples = [];
  for (const Extractor of [
    GitHubPullRequestsExtractor,
    GitHubIssuesExtractor,
    GitHubCommentsExtractor,
    GitHubRepliesExtractor,
    GitHubResolutionsExtractor,
    GitHubStarsExtractor,
    GitHubGistsExtractor,
  ]) {
    samples.push(...(await sampleTransform(new Extractor({}))));
  }
  const rendered = renderShapes(shapesOf(samples), { title: 'GitHub' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
