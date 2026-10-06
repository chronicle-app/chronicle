import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleCalendarEventsExtractor } from '../dist/index.js';
import { EVENTS, OWNER, TEAM, TOKEN, fakeCalendar } from './fixture.test-helper.js';

// Every run gets the token outright, so no test reads stored credentials.
async function extract(config = {}) {
  const extractor = new GoogleCalendarEventsExtractor({
    accessToken: TOKEN,
    quiet: true,
    ...config,
  });
  await extractor.setup();
  const records = [];
  for await (const record of extractor.extract()) records.push(record);
  const transformer = extractor.instantiateDefaultTransformer();
  const actions = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) actions.push(node.data);
  }
  return { extractor, records, actions };
}

// People are keyed by address alone, as mail keys them, so a guest and a
// correspondent are one person.
const person = (handle, name, extra = {}) => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source: 'email',
  handle,
  name,
  ...extra,
});
const owner = person(OWNER, 'Test Owner', { sameAs: ['@me'] });
const calendar = (sourceId, name) => ({
  '@type': 'Collection',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'google-calendar',
  sourceId,
  name,
});
const guest = person('guest@example.com', 'Test Guest');

test('events on the shown calendars become plans for named events, with their guests', async t => {
  const requests = await fakeCalendar(t);
  const { extractor, records, actions } = await extract();

  // Newest first across calendars. Holidays and hidden calendars are left
  // out; cancelled events too.
  assert.deepEqual(
    records.map(record => extractor.keyOf(record)),
    [
      `${OWNER}/trip1`,
      `${OWNER}/standup_20250311T130000Z`,
      `${OWNER}/planning1`,
      `${TEAM}/planning-copy`,
    ]
  );
  const eventReads = requests.filter(r => r.path.endsWith('/events'));
  assert.deepEqual(
    new Set(eventReads.map(r => r.path)),
    new Set([`/calendars/${OWNER}/events`, `/calendars/${TEAM}/events`])
  );
  // Without --since, the earliest event bounds the walk back, and every read
  // is a bounded window, so recurring events end.
  assert.ok(eventReads.some(r => r.query.maxResults === '1' && !r.query.timeMin));
  const windows = eventReads.filter(r => r.query.timeMin);
  assert.ok(windows.every(r => r.query.singleEvents === 'true' && r.query.timeMax));
  assert.equal(records[3].data.calendar.summary, 'Work');

  const [trip, standup, planning, copy] = actions;
  assert.deepEqual(planning, {
    '@type': 'PlanAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'icalendar',
    sourceId: 'planning@example.com',
    timestamp: new Date('2025-03-01T09:00:00Z'),
    agent: owner,
    // This calendar's copy, by Google's ID for it (its link's eid), the
    // same event as every copy with its UID.
    object: {
      '@type': 'Event',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'google-calendar',
      sourceId: 'planning1',
      sameAs: [
        {
          '@type': 'Event',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'icalendar',
          sourceId: 'planning@example.com',
        },
      ],
      name: 'Planning',
      // Google's HTML as Markdown, the tracking off its link.
      description: 'Agenda in [the doc](https://docs.example.com/agenda).\n\n**Bring** notes.',
      scheduledStart: new Date('2025-03-10T14:00:00Z'),
      scheduledEnd: new Date('2025-03-10T15:00:00Z'),
      location: { '@type': 'Location', address: '1 Example Street' },
      isPartOf: [calendar(OWNER, OWNER)],
      // The room booked for it isn't a guest.
      attendee: [owner, guest],
    },
    '@assertedAt': new Date('2025-03-01T09:00:00Z'),
  });
  // The same meeting on another calendar is that calendar's copy: one
  // planning, and the same event by its UID.
  assert.equal(copy.sourceId, planning.sourceId);
  assert.equal(copy.object.sourceId, 'planning2');
  assert.deepEqual(copy.object.sameAs, planning.object.sameAs);
  assert.deepEqual(copy.object.isPartOf, [calendar(TEAM, 'Work')]);

  // An all-day event keeps its dates as dates, March 14 through 15.
  assert.equal(trip.object.scheduledStart, '2025-03-14');
  // Google's end is the day after the last; the event ends on the last day.
  assert.equal(trip.object.scheduledEnd, '2025-03-15');
  assert.equal(trip.object.attendee, undefined);

  // Each instance of a recurring event is its own event, planned by its organizer.
  assert.equal(standup.object.sameAs[0].sourceId, 'standup@example.com@2025-03-11T13:00:00.000Z');
  assert.equal(standup.sourceId, standup.object.sameAs[0].sourceId);
  assert.deepEqual(standup.agent, guest);
});

test('--link-contacts links guests to your contacts', async t => {
  await fakeCalendar(t);
  const { actions } = await extract({ linkContacts: true });
  const standup = actions.find(action => action.object.name === 'Standup');
  assert.deepEqual(standup.agent.sameAs, [
    {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'phone',
      handle: '+14165550199',
    },
  ]);
});

test('the window and calendars can be narrowed', async t => {
  const requests = await fakeCalendar(t);
  const since = new Date('2025-03-01T00:00:00Z');
  const until = new Date('2025-04-01T00:00:00Z');
  const { records } = await extract({ since, until, calendar: TEAM, limit: 1 });

  assert.equal(records.length, 1);
  const read = requests.find(r => r.path.endsWith('/events'));
  assert.equal(read.path, `/calendars/${TEAM}/events`);
  assert.equal(read.query.timeMin, since.toISOString());
  assert.equal(read.query.timeMax, until.toISOString());
});

test('an event exactly on the edge between two reads is read once', async t => {
  await fakeCalendar(t);
  const until = new Date('2025-06-01T00:00:00Z');
  // Reads go back 90 days at a time, so one edge falls on 2025-03-03.
  const edge = { dateTime: '2025-03-03T00:00:00Z' };
  EVENTS[TEAM].push({
    id: 'edge1',
    iCalUID: 'edge@example.com',
    summary: 'Edge',
    start: edge,
    end: edge,
    organizer: { email: OWNER, self: true },
  });
  t.after(() => EVENTS[TEAM].pop());

  const { extractor, records } = await extract({ since: new Date('2025-01-01T00:00:00Z'), until });
  const keys = records.map(record => extractor.keyOf(record));
  assert.deepEqual(
    keys.filter(key => key.endsWith('/edge1')),
    [`${TEAM}/edge1`]
  );
  assert.equal(new Set(keys).size, keys.length);
});

test('a long event comes out by its start, after later events, and one with no organizer has its calendar', async t => {
  await fakeCalendar(t);
  // Reads go back 90 days from June 1, so one edge falls on March 3. The trip
  // starts before it and ends after: the newer read returns it too.
  const trip = {
    id: 'long1',
    iCalUID: 'long@example.com',
    summary: 'Long trip',
    start: { date: '2025-02-20' },
    end: { date: '2025-03-10' },
    organizer: { email: OWNER, self: true },
  };
  // Copied in from elsewhere: no organizer, no creator.
  const orphan = {
    id: 'orphan1',
    iCalUID: 'orphan@example.com',
    summary: 'Copied',
    start: { dateTime: '2025-02-25T10:00:00Z' },
    end: { dateTime: '2025-02-25T11:00:00Z' },
  };
  EVENTS[OWNER].push(trip, orphan);
  t.after(() => EVENTS[OWNER].splice(-2));

  const { records, actions } = await extract({
    since: new Date('2025-01-01T00:00:00Z'),
    until: new Date('2025-06-01T00:00:00Z'),
  });
  const starts = records.map(record => {
    const { start } = record.data.event;
    return new Date(start.dateTime ?? start.date).getTime();
  });
  assert.deepEqual(
    starts,
    starts.toSorted((a, b) => b - a)
  );
  const copied = actions.find(action => action.object.name === 'Copied');
  assert.deepEqual(copied.agent, {
    '@type': 'Agent',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'google-calendar',
    sourceId: OWNER,
    name: OWNER,
    sameAs: ['@me'],
  });
});

test('an event without an end gets iCalendar’s; one without a start is skipped', async t => {
  await fakeCalendar(t);
  const organizer = { email: OWNER, self: true };
  EVENTS[TEAM].push(
    {
      id: 'day1',
      iCalUID: 'day@example.com',
      summary: 'Day',
      start: { date: '2025-03-05' },
      organizer,
    },
    {
      id: 'due1',
      iCalUID: 'due@example.com',
      summary: 'Due',
      start: { dateTime: '2025-03-06T17:00:00Z' },
      organizer,
    },
    { id: 'none1', iCalUID: 'none@example.com', summary: 'Nowhen', organizer }
  );
  t.after(() => EVENTS[TEAM].splice(-3));

  const { actions, extractor } = await extract({
    since: new Date('2025-03-01T00:00:00Z'),
    until: new Date('2025-03-31T00:00:00Z'),
  });
  const schedule = name => {
    const event = actions.find(action => action.object.name === name)?.object;
    return event && { start: event.scheduledStart, end: event.scheduledEnd };
  };
  // An all-day event with no end lasts its one day; a timed one ends as it starts.
  assert.deepEqual(schedule('Day'), { start: '2025-03-05', end: '2025-03-05' });
  assert.deepEqual(schedule('Due'), {
    start: new Date('2025-03-06T17:00:00Z'),
    end: new Date('2025-03-06T17:00:00Z'),
  });
  assert.equal(schedule('Nowhen'), undefined);
  assert.equal(extractor.unscheduled.size, 1);
});

test('a rejected token says to sign in again', async t => {
  await fakeCalendar(t);
  await assert.rejects(extract({ accessToken: 'stale' }), error => {
    assert.equal(error.code, 'auth-required');
    assert.match(error.hint, /chronicle auth login google/);
    return true;
  });
});
