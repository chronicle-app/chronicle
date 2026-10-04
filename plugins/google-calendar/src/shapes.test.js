import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import { GoogleCalendarEventsExtractor } from '../dist/index.js';
import { TOKEN, fakeCalendar } from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  await fakeCalendar(t);
  const samples = await sampleTransform(new GoogleCalendarEventsExtractor({ accessToken: TOKEN }));
  const rendered = renderShapes(shapesOf(samples), { title: 'Google Calendar' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
