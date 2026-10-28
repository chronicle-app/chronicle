import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent, processEvents } from '../process.js';

// An open span and its close: a direct source emits an action with
// `startTime` and no `endTime` (in-progress), heartbeats re-assert it at later
// `@assertedAt`, and the close event contributes the `endTime`. `end_time` is a
// max-wins register with NULL identity, so one action row converges on the
// final span regardless of arrival order — while founding (the earliest
// witness) keeps the point fields.
const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
const session = (over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent: me,
  '@key': ['source', 'sourceId'],
  sourceId: 'session-42', // shared → one action across open/heartbeat/close
  startTime: '2026-07-17T14:00:00.000Z',
  ...over,
});

const T_OPEN = '2026-07-17T14:00:01.000Z';
const T_HEARTBEAT = '2026-07-17T14:10:00.000Z';
const T_CLOSE = '2026-07-17T14:25:00.000Z';
const END = '2026-07-17T14:24:30.000Z';

const open = session({ '@assertedAt': T_OPEN });
const heartbeat = session({ '@assertedAt': T_HEARTBEAT });
const close = session({ '@assertedAt': T_CLOSE, endTime: END });

const span = (sqlite: SqliteDriver) =>
  sqlite
    .prepare('SELECT start_time AS start, end_time AS end, COUNT(*) OVER () AS n FROM actions')
    .get() as { start: number | null; end: number | null; n: number };

describe('open span close-out (end_time register)', () => {
  it('stays open until the close event contributes an endTime', async () => {
    const { db, sqlite, close: done } = makeTestDb();
    try {
      await processEvent(db, open);
      await processEvent(db, heartbeat);
      expect(span(sqlite)).toEqual({
        start: Date.parse('2026-07-17T14:00:00.000Z'),
        end: null,
        n: 1,
      });

      await processEvent(db, close);
      expect(span(sqlite)).toEqual({
        start: Date.parse('2026-07-17T14:00:00.000Z'),
        end: Date.parse(END),
        n: 1,
      });
    } finally {
      done();
    }
  });

  it('converges on the same span in every arrival order', async () => {
    const orders = [
      [open, heartbeat, close],
      [open, close, heartbeat],
      [heartbeat, open, close],
      [heartbeat, close, open],
      [close, open, heartbeat],
      [close, heartbeat, open],
    ];
    for (const order of orders) {
      const { db, sqlite, close: done } = makeTestDb();
      try {
        for (const event of order) await processEvent(db, event); // eslint-disable-line no-await-in-loop
        expect(span(sqlite)).toEqual({
          start: Date.parse('2026-07-17T14:00:00.000Z'),
          end: Date.parse(END),
          n: 1,
        });
      } finally {
        done();
      }
    }
  });

  it('is idempotent under re-delivery and batches like a drain replay', async () => {
    const { db, sqlite, close: done } = makeTestDb();
    try {
      await processEvents(db, [open, heartbeat, close, close, heartbeat, open]);
      expect(span(sqlite)).toEqual({
        start: Date.parse('2026-07-17T14:00:00.000Z'),
        end: Date.parse(END),
        n: 1,
      });
    } finally {
      done();
    }
  });

  it('never shrinks: a stale smaller endTime cannot reopen or clip the span', async () => {
    const { db, sqlite, close: done } = makeTestDb();
    try {
      const earlierClose = session({
        '@assertedAt': '2026-07-17T14:30:00.000Z',
        endTime: '2026-07-17T14:15:00.000Z', // before the landed close
      });
      await processEvent(db, close);
      await processEvent(db, earlierClose);
      expect(span(sqlite).end).toBe(Date.parse(END));
    } finally {
      done();
    }
  });
});
