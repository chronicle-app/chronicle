import { parse } from '@chronicle.app/cql';
import { describe, expect, it } from 'vitest';
import { processEvents } from '../process.js';
import { queryPage } from '../query/cql.js';
import { makeTestDb } from '../testing/testDb.js';
import { serializeRows } from './rows.js';

const key = ['source', 'sourceId'];
const person = (sourceId: string, name: string) => ({
  '@type': 'Person',
  source: 'test',
  sourceId,
  '@key': key,
  name,
});
const book = { '@type': 'Book', source: 'test', sourceId: 'b1', '@key': key, name: 'Middlemarch' };
const action = (type: string, sourceId: string, over: Record<string, unknown>) => ({
  '@type': type,
  source: 'test',
  sourceId,
  '@key': key,
  ...over,
});

const message = action('MessageAction', 'm1', {
  timestamp: '2024-01-05T10:00:00Z',
  agent: person('ada', 'Ada'),
  object: {
    '@type': 'Message',
    source: 'test',
    sourceId: 'msg1',
    '@key': key,
    body: 'lunch?',
    recipient: [person('bo', 'Bo')],
  },
});

const rowsFor = (open: ReturnType<typeof makeTestDb>, cql: string) => {
  const page = queryPage(open.sqlite, parse(cql));
  return serializeRows(open.db, page.target, page.ids);
};

describe('serializeRows', () => {
  it('gives an action its type, time and source, and each role entity with its values', async () => {
    const open = makeTestDb();
    try {
      await processEvents(open.db, [message]);
      expect(rowsFor(open, 'type:MessageAction')).toEqual([
        {
          '@type': 'MessageAction',
          timestamp: '2024-01-05T10:00:00.000Z',
          source: 'test',
          agent: { '@type': 'Person', name: 'Ada' },
          object: {
            '@type': 'Message',
            body: 'lunch?',
            recipient: { '@type': 'Person', name: 'Bo' },
          },
        },
      ]);
    } finally {
      open.close();
    }
  });

  it('gives a span as its start and end instead of a timestamp', async () => {
    const open = makeTestDb();
    try {
      await processEvents(open.db, [
        action('ReadAction', 'r1', {
          startTime: '2024-03-01T09:00:00Z',
          endTime: '2024-03-01T10:00:00Z',
          agent: person('ada', 'Ada'),
          object: book,
        }),
      ]);
      const [row] = rowsFor(open, 'type:ReadAction');
      expect(row).toMatchObject({
        startTime: '2024-03-01T09:00:00.000Z',
        endTime: '2024-03-01T10:00:00.000Z',
      });
      expect(row).not.toHaveProperty('timestamp');
    } finally {
      open.close();
    }
  });

  it("gives an entity its current values, and leaves out a run that's closed", async () => {
    const open = makeTestDb();
    try {
      const like = (type: string, sourceId: string, timestamp: string) =>
        action(type, sourceId, { timestamp, agent: person('bo', 'Bo'), object: book });
      await processEvents(open.db, [like('LikeAction', 'l1', '2024-02-01T09:00:00Z')]);
      expect(rowsFor(open, 'type:Book')).toEqual([
        { '@type': 'Book', name: 'Middlemarch', liked: true },
      ]);

      await processEvents(open.db, [like('UnlikeAction', 'l2', '2024-02-02T09:00:00Z')]);
      expect(rowsFor(open, 'type:Book')).toEqual([{ '@type': 'Book', name: 'Middlemarch' }]);
    } finally {
      open.close();
    }
  });

  it('lists every current value of a predicate two sources disagree on', async () => {
    const open = makeTestDb();
    try {
      const recording = (source: string, duration: string) => ({
        '@type': 'MusicRecording',
        source,
        sourceId: 't1',
        '@key': key,
        name: 'Clair de Lune',
        duration,
        url: 'https://example.com/t1',
      });
      await processEvents(open.db, [
        action('ListenAction', 'p1', {
          timestamp: '2024-04-01T09:00:00Z',
          object: recording('a', 'PT5M'),
        }),
        {
          ...action('ListenAction', 'p2', { timestamp: '2024-04-02T09:00:00Z' }),
          source: 'b',
          object: recording('b', 'PT5M2S'),
        },
      ]);
      expect(rowsFor(open, 'type:MusicRecording')).toEqual([
        {
          '@type': 'MusicRecording',
          name: 'Clair de Lune',
          duration: ['PT5M', 'PT5M2S'],
          url: 'https://example.com/t1',
        },
      ]);
    } finally {
      open.close();
    }
  });
});
