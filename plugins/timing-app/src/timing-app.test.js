import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppUsageExtractor,
  TimeEntriesExtractor,
  TimingCallExtractor,
  TimingDefaultExtractor,
  TimingDefaultTransformer,
} from '../dist/index.js';
import {
  MAC_GLOBAL_ID,
  PHONE_GLOBAL_ID,
  writeAddressBook,
  writeTimingFixture,
} from './fixture.test-helper.js';

// The call transformer resolves contacts through the macOS AddressBook under
// HOME. Point HOME at a temp dir holding a synthetic AddressBook, so the test
// never reads the host's contacts. The lookup is lazy, so this runs before it.
const home = mkdtempSync(join(tmpdir(), 'timing-app-home-'));
process.env.HOME = home;
writeAddressBook(home);
const input = writeTimingFixture(home);
after(() => rmSync(home, { recursive: true, force: true }));

async function extract(Extractor, config) {
  const extractor = new Extractor({ input, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

async function actions(Extractor, config) {
  const transformer = new TimingDefaultTransformer();
  const out = [];
  for (const record of await extract(Extractor, config)) {
    for (const node of await transformer.performTransform(record)) out.push(node.data);
  }
  return out;
}

const iso = seconds => new Date((1_735_689_600 + seconds) * 1000).toISOString();
const byId = (Model, id) => ({
  '@type': Model,
  '@key': ['@type', 'source', 'sourceId'],
  source: 'timing-app',
  sourceId: id,
});
const me = { '@type': 'Agent', '@key': ['@type', 'source'], source: 'timing-app', sameAs: ['@me'] };
const project = (id, name, parent) => ({
  ...byId('Project', id),
  name,
  '@asserts': ['isPartOf'],
  ...(parent && { isPartOf: [parent] }),
});
const work = project('1', 'Work');
const realm = {
  '@type': 'Realm',
  '@key': ['@type', 'source', 'handle'],
  source: 'hostname',
  handle: 'pat-mbp',
};
const mac = {
  ...byId('Device', MAC_GLOBAL_ID),
  name: 'pat-mbp.local',
  category: ['computer'],
  model: 'Mac15,3',
  sameAs: [
    {
      '@type': 'Device',
      '@key': ['@type', 'source', 'handle'],
      source: 'mac-address',
      handle: '00:11:22:33:44:55',
    },
  ],
  inRealm: realm,
};
const app = (handle, name, source = 'apple-bundle-id') => ({
  '@type': 'SoftwareApplication',
  '@key': ['@type', 'source', 'handle'],
  source,
  handle,
  name,
});
const file = (type, handle, name) => ({
  '@type': type,
  '@key': ['source', 'handle', 'inRealm.handle'],
  source: 'filesystem',
  handle,
  name,
  inRealm: realm,
});
const execute = (id, start, end, result, object, instrument = mac) => ({
  ...byId('ExecuteAction', id),
  startTime: iso(start),
  endTime: iso(end),
  agent: me,
  result: { ...byId('DeviceSession', id), ...result },
  object,
  instrument,
  '@assertedAt': iso(start),
});
const call = (id, start, end, result) => ({
  '@type': 'CallAction',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'apple-phone',
  sourceId: id,
  startTime: iso(start),
  endTime: iso(end),
  result: {
    '@type': 'CallSession',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'apple-phone',
    sourceId: id,
    ...result,
  },
  '@assertedAt': iso(start),
});
const handleAgent = (source, handle) => ({
  '@type': 'Agent',
  '@key': ['source', 'handle'],
  source,
  handle,
});
const contact = (id, name) => ({
  '@type': 'Person',
  '@key': ['source', 'sourceId'],
  source: 'apple-contacts',
  sourceId: id,
  name,
});

test('the default run merges app usage, time entries, and calls, newest first', async () => {
  const out = await actions(TimingDefaultExtractor, { all: true });
  assert.deepEqual(
    out.map(a => a.sourceId),
    ['105', '104', '103', 'CALL-0003', '102', 'CALL-0002', '201', 'CALL-0001', '101']
  );
  const get = id => out.find(a => a.sourceId === id);

  // A terminal's working directory is where the session happened; the window
  // title names the session, and the project nests its ancestry.
  assert.deepEqual(
    get('101'),
    execute(
      '101',
      100,
      400,
      {
        isPartOf: [project('2', 'Chronicle', work)],
        workingDirectory: file('Directory', '/Users/pat/projects/chronicle', 'chronicle'),
        name: 'sleep 4',
      },
      app('com.mitchellh.ghostty', 'Ghostty')
    )
  );

  // A web page is keyed by URL; the app suffix is stripped from the title.
  assert.deepEqual(
    get('102'),
    execute(
      '102',
      500,
      800,
      {
        isPartOf: [work],
        subject: [{ '@type': 'Entity', '@key': ['url'], url: 'https://example.com/docs' }],
        name: 'Chronicle docs',
      },
      app('com.google.Chrome', 'Google Chrome')
    )
  );

  // A file is typed by its extension; a title that repeats its name is dropped.
  assert.deepEqual(
    get('103'),
    execute(
      '103',
      900,
      1000,
      { subject: [file('DocumentObject', '/Users/pat/my notes.md', 'my notes.md')] },
      app('com.apple.TextEdit', 'TextEdit')
    )
  );

  // An app with no bundle id is keyed on its executable. An unknown extension
  // stays a plain MediaObject, and a sample project is left out.
  assert.deepEqual(
    get('104'),
    execute(
      '104',
      1100,
      1200,
      {
        subject: [file('MediaObject', '/Users/pat/projects/Makefile', 'Makefile')],
        name: 'Makefile (~/projects)',
      },
      app('/usr/bin/vim', 'vim', 'timing-app')
    )
  );

  // A Screen Time-relayed device carries no MAC address.
  assert.deepEqual(
    get('105'),
    execute('105', 1300, 1400, {}, app('com.example.notes', 'Notes'), {
      ...byId('Device', PHONE_GLOBAL_ID),
      name: 'pat-iphone',
      category: ['phone'],
      model: 'iPhone15,2',
      inRealm: { ...realm, handle: 'pat-iphone' },
    })
  );

  // A time entry is an ExperienceAction whose result is a lean Session.
  assert.deepEqual(get('201'), {
    ...byId('ExperienceAction', '201'),
    startTime: iso(200),
    endTime: iso(3800),
    agent: me,
    result: {
      ...byId('Session', '201'),
      name: 'Bedtime routine',
      notes: 'with family',
      isPartOf: [project('4', 'Family')],
    },
    '@assertedAt': iso(200),
  });

  // A raw handle becomes an apple-phone party, named from the contact card.
  assert.deepEqual(
    get('CALL-0001'),
    call('CALL-0001', 150, 183, {
      recipient: [
        {
          ...handleAgent('apple-phone', '+14165550123'),
          name: 'Alex Chen',
          sameAs: [handleAgent('phone', '+14165550123'), contact('contact-alex', 'Alex Chen')],
        },
      ],
    })
  );

  // A resolvable name becomes the contact card; a missing end is zero-length.
  assert.deepEqual(
    get('CALL-0002'),
    call('CALL-0002', 450, 450, {
      recipient: [
        {
          ...contact('contact-sam', 'Sam Rivera'),
          sameAs: [handleAgent('phone', '+14165550199'), handleAgent('email', 'sam@example.com')],
        },
      ],
    })
  );

  // An unresolvable name rides on a sameAs'd timing-app session.
  assert.deepEqual(
    get('CALL-0003'),
    call('CALL-0003', 650, 700, {
      sameAs: [
        {
          '@type': 'CallSession',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'timing-app',
          sourceId: 'CALL-0003',
          name: 'Nobody Known',
        },
      ],
    })
  );

  // --limit applies to the merged stream.
  assert.deepEqual(
    (await actions(TimingDefaultExtractor, { all: true, limit: 2 })).map(a => a.sourceId),
    ['105', '104']
  );
});

const ids = records => records.map(r => r.context.id ?? r.context.uuid);

test('the focused extractors skip deleted, running, and non-call rows, and honor the window', async () => {
  assert.deepEqual(ids(await extract(TimeEntriesExtractor, {})), ['201']);
  assert.deepEqual(ids(await extract(TimingCallExtractor, {})), [
    'CALL-0003',
    'CALL-0002',
    'CALL-0001',
  ]);
  assert.deepEqual(
    ids(
      await extract(AppUsageExtractor, {
        since: new Date(iso(499)),
        until: new Date(iso(1100)),
      })
    ),
    ['103', '102']
  );

  // With a count cap and no --all, only the last 90 days are read.
  assert.deepEqual(await extract(AppUsageExtractor, { limit: 5 }), []);
  assert.deepEqual(ids(await extract(AppUsageExtractor, { limit: 2, all: true })), ['105', '104']);

  const extractor = new AppUsageExtractor({ input, all: true, limit: 0 });
  try {
    await extractor.setup();
    assert.equal(await extractor.determineCount(), 5);
  } finally {
    await extractor.teardown();
  }
});
