import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '@chronicle.app/etl';
import {
  SpotifyArchiveLibraryExtractor,
  SpotifyArchiveListensExtractor,
  SpotifyArchivePlaylistsExtractor,
  SpotifyArchiveSearchesExtractor,
  SpotifyPlaylistsExtractor,
  SpotifyRecentlyPlayedExtractor,
  SpotifySavedAlbumsExtractor,
  SpotifySavedTracksExtractor,
} from '../dist/index.js';
import {
  accountDataFiles,
  serveSpotify,
  streamingHistoryFiles,
  TOKEN,
  writeDownload,
} from './fixture.test-helper.js';

// `npm run shapes` runs this file directly with --update to rewrite SHAPES.md.
const file = new URL('../SHAPES.md', import.meta.url);

test('SHAPES.md describes what every record type becomes', async t => {
  await serveSpotify(t);
  const input = mkdtempSync(join(tmpdir(), 'spotify-shapes-'));
  t.after(() => rmSync(input, { recursive: true, force: true }));
  writeDownload(join(input, 'Spotify Account Data'), accountDataFiles());
  writeDownload(join(input, 'Spotify Extended Streaming History'), streamingHistoryFiles());

  const extractors = [
    new SpotifyRecentlyPlayedExtractor({ accessToken: TOKEN }),
    new SpotifySavedTracksExtractor({ accessToken: TOKEN }),
    new SpotifySavedAlbumsExtractor({ accessToken: TOKEN }),
    new SpotifyPlaylistsExtractor({ accessToken: TOKEN }),
    new SpotifyArchiveListensExtractor({ input, quiet: true, lookup: false }),
    new SpotifyArchiveLibraryExtractor({ input, quiet: true, lookup: false }),
    new SpotifyArchivePlaylistsExtractor({ input, quiet: true, lookup: false }),
    new SpotifyArchiveSearchesExtractor({ input, quiet: true, lookup: false }),
  ];
  const samples = [];
  for (const extractor of extractors) samples.push(...(await sampleTransform(extractor)));
  const rendered = renderShapes(shapesOf(samples), { title: 'Spotify' });
  if (process.argv.includes('--update')) writeFileSync(file, rendered);
  else assert.equal(rendered, readFileSync(file, 'utf8'), 'Run npm run shapes');
});
