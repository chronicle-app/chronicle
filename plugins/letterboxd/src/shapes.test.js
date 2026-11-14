import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import { LetterboxdDefaultExtractor } from '../dist/index.js';
import { stubLetterboxd, writeLetterboxdExport } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'letterboxd-shapes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  stubLetterboxd(t);
  const samples = await sampleTransform(
    new LetterboxdDefaultExtractor({
      input: writeLetterboxdExport(dir),
      'film-pages': true,
      'film-cache': join(dir, 'films.json'),
      limit: 0,
    })
  );
  const rendered = renderShapes(shapesOf(samples), { title: 'Letterboxd' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
