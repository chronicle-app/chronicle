import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { openDatabase } from '../db/open.js';
import type { OpenResult } from '../db/open.js';
import { processEvents } from '../process.js';
import { lowerQuery } from './cql.js';
import { queryActionPage } from './evaluate.js';

/**
 * Composition replaces handles: every cross-result operation an
 * agent used to run in-harness over materialized rows is a construct of the
 * language, evaluated in the store over the full set —
 *
 *   - `while:{ <action anchor> }` — the root's occurrence overlaps the anchor's
 *     ("messages during my visits", and the mirror, "visits containing a
 *     message");
 *   - `with(1d):{ <action anchor> }` on an action root — within the window of
 *     an anchor action ("X and Y on the same day");
 *   - `near(1d):{ … }` — interval-aware on a durated root;
 *   - `duration:>=30m` — how long the occurrence lasted.
 */

const KEY = { '@key': ['source', 'sourceId'] };
const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  name: 'Me',
  sameAs: ['@me'],
  ...KEY,
};
const cafe = { '@type': 'Venue', source: 'test', sourceId: 'cafe', name: 'Cafe', ...KEY };
const park = { '@type': 'Venue', source: 'test', sourceId: 'park', name: 'Park', ...KEY };

const visit = (id: string, place: object, start: string, end: string) => ({
  '@type': 'VisitAction',
  source: 'test',
  sourceId: id,
  timestamp: start,
  startTime: start,
  endTime: end,
  agent: me,
  object: place,
  ...KEY,
});
const message = (id: string, at: string) => ({
  '@type': 'MessageAction',
  source: 'test',
  sourceId: id,
  timestamp: at,
  agent: me,
  object: { '@type': 'Message', source: 'test', sourceId: `m-${id}`, body: id, ...KEY },
  ...KEY,
});
const listen = (id: string, at: string) => ({
  '@type': 'ListenAction',
  source: 'test',
  sourceId: id,
  timestamp: at,
  agent: me,
  object: { '@type': 'MusicRecording', source: 'test', sourceId: `t-${id}`, name: id, ...KEY },
  ...KEY,
});

async function seeded(): Promise<OpenResult> {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    visit('cafe-jan', cafe, '2024-01-10T09:00:00Z', '2024-01-10T11:00:00Z'),
    visit('park-jan', park, '2024-01-12T14:00:00Z', '2024-01-12T14:20:00Z'),
    visit('cafe-mar', cafe, '2024-03-01T09:00:00Z', '2024-03-01T09:45:00Z'),
    message('in-cafe', '2024-01-10T10:00:00Z'), // inside cafe-jan
    message('in-park', '2024-01-12T14:10:00Z'), // inside park-jan
    message('feb', '2024-02-05T12:00:00Z'), // inside nothing
    listen('same-day-as-park', '2024-01-12T20:00:00Z'),
    listen('lonely', '2024-02-20T20:00:00Z'),
  ]);
  return open;
}

function ids(open: OpenResult, cql: string): string[] {
  const page = queryActionPage(open.sqlite, lowerQuery(parse(cql)), { limit: 50 });
  const stmt = open.sqlite.prepare('SELECT source_id AS s FROM actions WHERE id = ?');
  return page.ids.map(id => (stmt.get(id) as { s: string }).s).sort();
}

describe('while:{ action anchor } — overlap of occurrences', () => {
  it('keeps the rows that happened during the anchor actions', async () => {
    const open = await seeded();
    try {
      expect(
        ids(open, 'type:MessageAction while:{ type:VisitAction object:{ name:"Cafe" } }')
      ).toEqual(['in-cafe']);
      expect(ids(open, 'type:MessageAction while:{ type:VisitAction }')).toEqual([
        'in-cafe',
        'in-park',
      ]);
    } finally {
      open.close();
    }
  });

  it('read the other way, keeps the spans that contain an anchor moment', async () => {
    const open = await seeded();
    try {
      expect(ids(open, 'type:VisitAction while:{ type:MessageAction }')).toEqual([
        'cafe-jan',
        'park-jan',
      ]);
      expect(ids(open, 'type:VisitAction -while:{ type:MessageAction }')).toEqual(['cafe-mar']);
    } finally {
      open.close();
    }
  });
});

describe('with(<gap>):{ action anchor } on an action root — co-occurrence in time', () => {
  it('keeps the rows within the window of an anchor action', async () => {
    const open = await seeded();
    try {
      expect(ids(open, 'type:ListenAction with(1d):{ type:VisitAction }')).toEqual([
        'same-day-as-park',
      ]);
      expect(ids(open, 'type:MessageAction with(1d):{ type:ListenAction }')).toEqual(['in-park']);
    } finally {
      open.close();
    }
  });

  it('refuses an entity-shaped anchor, which is the role slot', async () => {
    const open = await seeded();
    try {
      expect(() => ids(open, 'type:ListenAction with(1d):{ name:"Me" }')).toThrow(
        /relates it to other ACTIONS/
      );
    } finally {
      open.close();
    }
  });
});

describe('near(<gap>):{ … } — interval-aware on a durated root', () => {
  it('measures from the span, not just its start', async () => {
    const open = await seeded();
    try {
      // The lonely listen is Feb 20; nothing within a day of it.
      expect(
        ids(open, 'type:VisitAction near(1d):{ type:ListenAction object:{ name:"lonely" } }')
      ).toEqual([]);
      expect(ids(open, 'type:VisitAction near(12h):{ type:ListenAction }')).toEqual(['park-jan']);
    } finally {
      open.close();
    }
  });
});

describe('duration: on an action root', () => {
  it('compares and ranges the occurrence span', async () => {
    const open = await seeded();
    try {
      expect(ids(open, 'type:VisitAction duration:>=1h')).toEqual(['cafe-jan']);
      expect(ids(open, 'type:VisitAction duration:<30m')).toEqual(['park-jan']);
      expect(ids(open, 'type:VisitAction duration:30m..1h')).toEqual(['cafe-mar']);
      expect(ids(open, 'type:VisitAction duration:*')).toHaveLength(3);
      expect(ids(open, 'type:MessageAction duration:*')).toEqual([]);
    } finally {
      open.close();
    }
  });

  it('teaches on a value that is not a duration', async () => {
    const open = await seeded();
    try {
      expect(() => ids(open, 'type:VisitAction duration:>=long')).toThrow(/not a duration/);
    } finally {
      open.close();
    }
  });
});
