import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent, processEvents } from '../process.js';

function rows(sqlite: any, sql: string, ...args: any[]): any[] {
  return sqlite.prepare(sql).all(...args);
}

// A self-agent from `phone`, keyed on its E.164 handle, tagged with the `@me`
// self-token in its sameAs. Shares no keyset with the slack self below — only
// `@me` can unify them.
const phoneSelf = (over: Record<string, unknown> = {}) => ({
  '@type': 'Person',
  source: 'phone',
  handle: '+14165550000',
  '@key': ['@type', 'source', 'handle'],
  sameAs: ['@me'],
  ...over,
});

// A self-agent from `slack`, keyed on its `U0XXX` id, also `@me`. Authored as a
// bare `Agent` — it must still merge into the `Person` hub (the hub type is
// injected by the token expansion, not read from the carrier node).
const slackSelf = (over: Record<string, unknown> = {}) => ({
  '@type': 'Agent',
  source: 'slack',
  sourceId: 'U0ABC',
  '@key': ['@type', 'source', 'sourceId'],
  sameAs: ['@me'],
  ...over,
});

// An action whose agent is the given self node. The object lives under the
// action's own source so it never collides with the agent identity.
const act = (source: string, sourceId: string, agent: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source,
  sourceId,
  '@key': ['source', 'sourceId'],
  timestamp: '2023-01-01T00:00:00Z',
  agent,
  object: {
    '@type': 'Book',
    source,
    sourceId: `b-${sourceId}`,
    '@key': ['@type', 'source', 'sourceId'],
    name: `Book ${sourceId}`,
  },
});

const agentEntityIds = (sqlite: any): number[] =>
  rows(sqlite, 'SELECT DISTINCT cached_agent_entity_id AS id FROM actions ORDER BY id').map(
    r => r.id
  );

describe('@me — egocentric self-anchor', () => {
  it('merges self-agents from different sources onto one entity, regardless of order', async () => {
    for (const order of [
      () => [act('phone', 'm1', phoneSelf()), act('slack', 's1', slackSelf())],
      () => [act('slack', 's1', slackSelf()), act('phone', 'm1', phoneSelf())],
    ]) {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvents(db, order());
        // Both actions' agents (phone Person + slack Agent) resolve to one entity.
        expect(agentEntityIds(sqlite)).toHaveLength(1);
      } finally {
        close();
      }
    }
  });

  it('materializes the self hub as a Person / chronicle / myself row', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, act('phone', 'm1', phoneSelf()));

      const hub = rows(
        sqlite,
        "SELECT type, source, keyset, entity_id AS entityId FROM sourced_entities WHERE source = 'chronicle'"
      );
      expect(hub).toHaveLength(1);
      expect(hub[0].type).toBe('Person'); // injected, even though no @type was authored on the hub
      expect(hub[0].source).toBe('chronicle');
      expect(JSON.parse(hub[0].keyset)).toEqual({
        '@type': 'Person',
        source: 'chronicle',
        handle: 'myself',
      });

      // The phone self resolves to the same harmonized entity as the hub.
      const phone = rows(
        sqlite,
        "SELECT entity_id AS entityId FROM sourced_entities WHERE source = 'phone'"
      );
      expect(phone[0].entityId).toBe(hub[0].entityId);
    } finally {
      close();
    }
  });

  it('composes with a coexisting sameAs edge — both merges apply', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // phone self carries BOTH the `@me` token and a sameAs to an email
      // identity; the email identity is also seen natively as the agent of its
      // own action.
      const emailId = {
        '@type': 'Person',
        source: 'email',
        handle: 'me@example.com',
        '@key': ['@type', 'source', 'handle'],
      };
      await processEvents(db, [
        act('phone', 'm1', phoneSelf({ sameAs: ['@me', emailId] })),
        act('slack', 's1', slackSelf()),
        act('email', 'e1', { ...emailId }), // native, untagged
      ]);

      // @me unifies phone+slack; sameAs folds email into the same entity — one id.
      expect(agentEntityIds(sqlite)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('does not record the structural sameAs edge as an observation', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, act('phone', 'm1', phoneSelf()));
      const obs = rows(
        sqlite,
        "SELECT COUNT(*) AS n FROM observations WHERE predicate = 'sameAs'"
      )[0] as { n: number };
      expect(obs.n).toBe(0);
    } finally {
      close();
    }
  });

  it('treats `@me` as a literal outside merge-edge positions', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // `@me` as a Book name is plain text — only a `sameAs` slot resolves it, so
      // this must NOT mint the self hub.
      await processEvent(db, {
        '@type': 'ReadAction',
        source: 'phone',
        sourceId: 'm1',
        '@key': ['source', 'sourceId'],
        timestamp: '2023-01-01T00:00:00Z',
        agent: {
          '@type': 'Person',
          source: 'phone',
          handle: '+14165550000',
          '@key': ['@type', 'source', 'handle'],
        },
        object: {
          '@type': 'Book',
          source: 'phone',
          sourceId: 'b1',
          '@key': ['@type', 'source', 'sourceId'],
          name: '@me',
        },
      });
      const hub = rows(
        sqlite,
        "SELECT COUNT(*) AS n FROM sourced_entities WHERE source = 'chronicle'"
      )[0] as { n: number };
      expect(hub.n).toBe(0);
    } finally {
      close();
    }
  });

  it('folds a duplicate @me token to one self hub (idempotent)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // A node may end up with `@me` twice (e.g. a self-tagging builder spread
      // then re-tagged). Both expand to the same hub keyset, so it stays one row.
      await processEvent(db, act('phone', 'm1', phoneSelf({ sameAs: ['@me', '@me'] })));
      const hub = rows(
        sqlite,
        "SELECT COUNT(*) AS n FROM sourced_entities WHERE source = 'chronicle'"
      )[0] as { n: number };
      expect(hub.n).toBe(1);
    } finally {
      close();
    }
  });
});
