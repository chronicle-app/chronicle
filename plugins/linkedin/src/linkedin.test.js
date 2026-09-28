import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LinkedInArchiveFollowsExtractor,
  LinkedInArchiveProfileExtractor,
  LinkedInDefaultExtractor,
  LinkedInTransformer,
} from '../dist/index.js';
import {
  memberName,
  parseCoarseDate,
  parseDayDate,
  parseLongStamp,
  parseSlashStamp,
  parseSpaceStamp,
  profileHandle,
} from '../dist/connectors/fields.js';
import { COMPILED_AT, writeLinkedInExport } from './fixture.test-helper.js';

const COMPILED = COMPILED_AT.toISOString();

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'linkedin-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function records(Extractor, config) {
  const extractor = new Extractor({ limit: 0, ...config });
  await extractor.setup();
  return Array.fromAsync(extractor.extract());
}

async function transform(record) {
  const transformer = new LinkedInTransformer();
  return (await transformer.performTransform(record)).map(node => node.data);
}

/** Mark every typed node the way a snapshot record's transform does. */
function asserted(node) {
  if (Array.isArray(node)) return node.map(item => asserted(item));
  if (node === null || typeof node !== 'object') return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, asserted(v)]));
  return node['@type'] ? { ...out, '@asserts': ['*'] } : out;
}

const personKey = ['@type', 'source', 'handle'];
const orgKey = ['@type', 'source', 'name'];

const ada = {
  '@type': 'Person',
  source: 'linkedin',
  handle: 'ada',
  name: 'Ada Lovelace',
  '@key': personKey,
  sameAs: [
    {
      '@type': 'Person',
      '@key': personKey,
      source: 'email',
      handle: 'ada@example.com',
      name: 'Ada Lovelace',
    },
    '@me',
  ],
  url: 'https://www.linkedin.com/in/ada',
  description: 'Building an analytical engine',
};

const member = (handle, name) => ({
  '@type': 'Person',
  '@key': personKey,
  source: 'linkedin',
  handle,
  url: `https://www.linkedin.com/in/${handle}`,
  ...(name && { name }),
});

const org = name => ({ '@type': 'Organization', '@key': orgKey, source: 'linkedin', name });

const thread = (sourceId, name) => ({
  '@type': 'Thread',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'linkedin',
  sourceId,
  ...(name && { name }),
});

test('the whole export becomes schema-valid actions, newest first', async t => {
  const input = writeLinkedInExport(tempDir(t));
  const all = await records(LinkedInDefaultExtractor, { input });

  // Everything dated interleaves newest-first; the undated profile lands last,
  // and the connection row that names nobody is dropped.
  assert.deepEqual(
    all.map(r => [r.extraction.recordType, r.data.occurredAt]),
    [
      ['connections', '2026-06-06'],
      ['messages', '2026-03-13T04:00:00.000Z'],
      ['messages', '2026-03-13T03:18:54.000Z'],
      ['follows', '2025-01-24T02:54:41.000Z'],
      ['messages', '2025-01-02T10:00:00.000Z'],
      ['messages', '2024-05-01T08:00:00.000Z'],
      ['positions', '2022-08'],
      ['learning', '2020-12-29T14:24:00.000Z'],
      ['connections', '2019-01-02'],
      ['endorsements', '2018-10-18T12:23:20.000Z'],
      ['endorsements', '2017-05-07T01:01:57.000Z'],
      ['positions', '2009'],
      ['education', '2003'],
      ['learning', undefined],
      ['profile', undefined],
    ]
  );

  const out = [];
  for (const record of all) out.push(...(await transform(record)));
  const byType = type => out.filter(node => node['@type'] === type);

  // A connection: a snapshot, so its as-of is the export's compile time.
  assert.deepEqual(
    byType('FollowAction')[0],
    asserted({
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.handle', 'object.name'],
      source: 'linkedin',
      agent: ada,
      object: {
        ...member('babbage', 'Charles Babbage'),
        description: 'Founder',
        memberOf: [org('Analytical Engines Ltd')],
        sameAs: [
          {
            '@type': 'Person',
            '@key': personKey,
            source: 'email',
            handle: 'babbage@example.com',
            name: 'Charles Babbage',
          },
        ],
      },
      timestamp: '2026-06-06',
      '@assertedAt': COMPILED,
    })
  );

  // Following an organization is an event, dated when it happened.
  assert.deepEqual(byType('FollowAction')[1], {
    '@type': 'FollowAction',
    '@key': ['@type', 'source', 'agent.handle', 'object.name'],
    source: 'linkedin',
    agent: ada,
    object: org('Analytical Engines Ltd'),
    timestamp: '2025-01-24T02:54:41.000Z',
    '@assertedAt': '2025-01-24T02:54:41.000Z',
  });

  const [yes, question, group, sponsored] = byType('MessageAction');
  const messageKey = [
    '@type',
    'source',
    'timestamp',
    'object.isPartOf[*].sourceId',
    'agent.handle',
    'agent.name',
  ];
  const bodyKey = ['@type', 'source', 'isPartOf[*].sourceId', 'author[*].handle', 'name', 'body'];

  // Your own slug as a party resolves to the self node.
  assert.deepEqual(yes, {
    '@type': 'MessageAction',
    '@key': messageKey,
    source: 'linkedin',
    timestamp: '2026-03-13T04:00:00.000Z',
    agent: ada,
    object: {
      '@type': 'Message',
      '@key': bodyKey,
      source: 'linkedin',
      isPartOf: [thread('2-conv-one')],
      body: 'Yes.',
      author: [ada],
      recipient: [member('babbage', 'Charles Babbage')],
    },
    '@assertedAt': '2026-03-13T04:00:00.000Z',
  });
  assert.equal(question.agent.handle, 'babbage');

  // Three names but two URLs: the names are dropped rather than mispaired, the
  // private sender stays unnamed, and the expiring attachment link is not kept.
  assert.deepEqual(group, {
    '@type': 'MessageAction',
    '@key': messageKey,
    source: 'linkedin',
    timestamp: '2025-01-02T10:00:00.000Z',
    object: {
      '@type': 'Message',
      '@key': bodyKey,
      source: 'linkedin',
      isPartOf: [thread('2-conv-two', 'Engine crew')],
      name: 'A subject',
      body: 'Group note',
      recipient: [member('hopper'), ada],
    },
    '@assertedAt': '2025-01-02T10:00:00.000Z',
  });
  assert.ok(!JSON.stringify(all).includes('/dms/prv/'));

  // An HTML body is stored as its text; a sender with no URL keys on the name.
  const recruiter = {
    '@type': 'Person',
    '@key': ['@type', 'source', 'name'],
    source: 'linkedin',
    name: 'Ada Recruiter',
  };
  assert.deepEqual(sponsored.object, {
    '@type': 'Message',
    '@key': bodyKey,
    source: 'linkedin',
    isPartOf: [thread('2-conv-three', 'Sponsored Conversation')],
    body: 'Hi there!\n\nRead more (https://example.com/jobs).',
    author: [recruiter],
    recipient: [ada],
  });
  assert.deepEqual(sponsored.agent, recruiter);

  // A job is a Join/Leave pair around one Tenure, at the precision LinkedIn wrote.
  const boundaryKey = ['@type', 'source', 'result.role', 'result.degree', 'object.name'];
  const advisor = {
    '@type': 'Tenure',
    '@key': ['@type', 'source', 'role', 'action.object.name'],
    source: 'linkedin',
    role: 'Advisor',
  };
  const boundary = (type, timestamp, object, result) =>
    asserted({
      '@type': type,
      '@key': boundaryKey,
      source: 'linkedin',
      agent: ada,
      object,
      timestamp,
      result,
      '@assertedAt': COMPILED,
    });
  assert.deepEqual(
    byType('JoinAction').map(a => [a.object.name, a.timestamp]),
    [
      ['Analytical Engines Ltd', '2022-08'],
      ['Difference Engine Co', '2009'],
      ['University of London', '2003'],
    ]
  );
  assert.deepEqual(byType('LeaveAction'), [
    boundary('LeaveAction', '2011', org('Difference Engine Co'), advisor),
    boundary('LeaveAction', '2009', org('University of London'), {
      '@type': 'Enrollment',
      '@key': ['@type', 'source', 'degree', 'action.object.name'],
      source: 'linkedin',
      degree: 'Bachelor of Science (B.S.)',
      description: 'Thesis on looms\n\nChess club',
    }),
  ]);
  assert.deepEqual(
    byType('JoinAction')[1],
    boundary('JoinAction', '2009', org('Difference Engine Co'), advisor)
  );

  // Endorsements point the right way for each file.
  const [received, given] = byType('RespondAction');
  assert.equal(received.agent.handle, 'hopper');
  assert.deepEqual(received.object, ada);
  assert.deepEqual(given, {
    '@type': 'RespondAction',
    '@key': ['@type', 'source', 'agent.handle', 'object.handle', 'result.body'],
    source: 'linkedin',
    agent: ada,
    object: member('babbage', 'Charles Babbage'),
    timestamp: '2017-05-07T01:01:57.000Z',
    result: {
      '@type': 'Response',
      '@key': ['@type', 'source', 'action.agent.handle', 'action.object.handle', 'body'],
      source: 'linkedin',
      body: 'Mechanical Computation',
      author: [ada],
      about: [
        {
          '@type': 'DefinedTerm',
          '@key': ['@type', 'source', 'name'],
          source: 'linkedin',
          name: 'Mechanical Computation',
        },
      ],
    },
    '@assertedAt': '2017-05-07T01:01:57.000Z',
  });

  // A course: watched, completed, and saved. The bookmark has no date of its
  // own, so it is sighted at the export's compile time. The unwatched, unsaved
  // course yields nothing.
  const course = {
    '@type': 'CreativeWork',
    '@key': ['@type', 'source', 'name'],
    source: 'linkedin',
    name: 'Looms for Programmers',
    description: 'A course about looms',
    sourceFormat: 'course',
  };
  const courseKey = ['@type', 'source', 'object.name', 'timestamp'];
  assert.deepEqual(
    out.filter(node => node.object?.['@type'] === 'CreativeWork'),
    [
      {
        '@type': 'WatchAction',
        '@key': courseKey,
        source: 'linkedin',
        agent: ada,
        object: course,
        timestamp: '2020-12-29T14:24:00.000Z',
        '@assertedAt': '2020-12-29T14:24:00.000Z',
      },
      {
        '@type': 'CompleteAction',
        '@key': courseKey,
        source: 'linkedin',
        agent: ada,
        object: course,
        timestamp: '2021-01-04T09:00:00.000Z',
        '@assertedAt': '2021-01-04T09:00:00.000Z',
      },
      {
        '@type': 'BookmarkAction',
        '@key': ['@type', 'source', 'object.name'],
        source: 'linkedin',
        agent: ada,
        object: course,
        '@assertedAt': COMPILED,
      },
    ]
  );

  // The profile: the self, sighted when LinkedIn compiled the export.
  assert.deepEqual(byType('UpdateAction'), [
    asserted({
      '@type': 'UpdateAction',
      '@key': ['@type', 'source', 'object.handle', 'timestamp'],
      source: 'linkedin',
      agent: ada,
      object: ada,
      timestamp: COMPILED,
      '@assertedAt': COMPILED,
    }),
  ]);
});

test('the self comes from the profile-url flag, else the invitations, else nothing', async t => {
  const input = writeLinkedInExport(tempDir(t));

  const [configured] = await records(LinkedInArchiveProfileExtractor, {
    input,
    'profile-url': 'https://www.linkedin.com/in/adalovelace?utm_source=share',
  });
  assert.equal(configured.data.handle, 'adalovelace');

  // With no invitation to read, the self falls back to the per-source singleton.
  unlinkSync(join(input, 'Invitations.csv'));
  const [record] = await records(LinkedInArchiveProfileExtractor, { input });
  assert.deepEqual(record.data, {
    name: 'Ada Lovelace',
    headline: 'Building an analytical engine',
    location: 'London, England, United Kingdom',
    email: 'ada@example.com',
    handle: undefined,
  });
  const [update] = await transform(record);
  assert.deepEqual(update.object, {
    '@type': 'Person',
    source: 'linkedin',
    name: 'Ada Lovelace',
    '@key': ['@type', 'source'],
    sameAs: [
      {
        '@type': 'Person',
        '@key': personKey,
        source: 'email',
        handle: 'ada@example.com',
        name: 'Ada Lovelace',
        '@asserts': ['*'],
      },
      '@me',
    ],
    description: 'Building an analytical engine',
    '@asserts': ['*'],
  });
});

test('a missing file reads as empty, and since/until bound the dated records', async t => {
  const empty = tempDir(t);
  assert.deepEqual(await records(LinkedInDefaultExtractor, { input: empty }), []);

  const input = writeLinkedInExport(tempDir(t));
  const windowed = await records(LinkedInDefaultExtractor, {
    input,
    since: new Date('2025-01-01T00:00:00Z'),
    until: new Date('2026-01-01T00:00:00Z'),
  });
  // The undated course and profile always pass.
  assert.deepEqual(
    windowed.map(r => [r.extraction.recordType, r.data.occurredAt]),
    [
      ['follows', '2025-01-24T02:54:41.000Z'],
      ['messages', '2025-01-02T10:00:00.000Z'],
      ['learning', undefined],
      ['profile', undefined],
    ]
  );

  await assert.rejects(
    records(LinkedInArchiveFollowsExtractor, { input: join(empty, 'missing') }),
    /Could not read the LinkedIn export directory/
  );
});

test('field readers keep what LinkedIn wrote at its own precision', () => {
  assert.equal(profileHandle('www.linkedin.com/in/ada/'), 'ada');
  assert.equal(profileHandle('https://www.linkedin.com/in/fran%C3%A7ois-b-1'), 'françois-b-1');
  assert.equal(profileHandle('https://www.linkedin.com/company/example'), undefined);
  assert.equal(memberName('LinkedIn Member'), undefined);
  assert.equal(parseDayDate('2 January 2019'), '2019-01-02');
  assert.equal(parseDayDate('nonsense'), undefined);
  assert.equal(parseCoarseDate('Aug 2022'), '2022-08');
  assert.equal(parseCoarseDate('2009'), '2009');
  assert.equal(parseSpaceStamp('N/A'), undefined);
  assert.equal(parseSlashStamp('2017/05/07 01:01:57 UTC'), '2017-05-07T01:01:57.000Z');
  assert.equal(parseLongStamp('Fri Jan 24 02:54:41 UTC 2025'), '2025-01-24T02:54:41.000Z');
});
