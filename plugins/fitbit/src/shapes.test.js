import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import {
  FitbitActivityExtractor,
  FitbitBodyMeasurementsExtractor,
  FitbitExercisesExtractor,
  FitbitHeartExtractor,
  FitbitSleepExtractor,
} from '../dist/index.js';
import { writeFitbitArchive } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fitbit-shapes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = writeFitbitArchive(dir);
  const samples = [];
  for (const Extractor of [
    FitbitExercisesExtractor,
    FitbitSleepExtractor,
    FitbitHeartExtractor,
    FitbitActivityExtractor,
    FitbitBodyMeasurementsExtractor,
  ]) {
    samples.push(...(await sampleTransform(new Extractor({ input, limit: 0 }))));
  }
  const rendered = renderShapes(shapesOf(samples), { title: 'Fitbit' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
