import { createServer } from 'node:http';
import { GoogleCalendarEventsExtractor } from '../dist/index.js';

/** Synthetic calendars and people; nothing here is anyone's real data. */
export const TOKEN = 'synthetic-token';
export const OWNER = 'owner@example.com';
export const TEAM = 'team@group.calendar.google.com';
const HOLIDAYS = 'en.example#holiday@group.v.calendar.google.com';
const HIDDEN = 'hidden@group.calendar.google.com';

const me = { email: OWNER, displayName: 'Test Owner', self: true };
const guest = { email: 'guest@example.com', displayName: 'Test Guest' };

const planning = {
  id: 'planning1',
  iCalUID: 'planning@example.com',
  status: 'confirmed',
  htmlLink: 'https://calendar.google.com/event?eid=planning1',
  created: '2025-03-01T09:00:00Z',
  updated: '2025-03-02T09:00:00Z',
  summary: 'Planning',
  // As Google's editor writes it: HTML, with a tracked link.
  description:
    'Agenda in <a href="https://docs.example.com/agenda?utm_source=calendar">the doc</a>.<br><br><b>Bring</b> notes.',
  location: '1 Example Street',
  start: { dateTime: '2025-03-10T10:00:00-04:00' },
  end: { dateTime: '2025-03-10T11:00:00-04:00' },
  organizer: me,
  creator: me,
  attendees: [
    { ...me, organizer: true, responseStatus: 'accepted' },
    { ...guest, responseStatus: 'accepted' },
    { email: 'room@resource.calendar.google.com', displayName: 'Room 1', resource: true },
  ],
};

export const EVENTS = {
  [OWNER]: [
    planning,
    {
      id: 'trip1',
      iCalUID: 'trip@example.com',
      created: '2025-02-01T12:00:00Z',
      summary: 'Trip',
      start: { date: '2025-03-14' },
      end: { date: '2025-03-16' },
      organizer: { email: OWNER, self: true },
    },
    {
      id: 'standup_20250311T130000Z',
      iCalUID: 'standup@example.com',
      recurringEventId: 'standup',
      originalStartTime: { dateTime: '2025-03-11T09:00:00-04:00' },
      created: '2025-01-05T12:00:00Z',
      summary: 'Standup',
      start: { dateTime: '2025-03-11T09:00:00-04:00' },
      end: { dateTime: '2025-03-11T09:15:00-04:00' },
      organizer: guest,
      attendees: [
        { ...guest, organizer: true, responseStatus: 'accepted' },
        { ...me, responseStatus: 'declined' },
      ],
    },
    { id: 'gone1', iCalUID: 'gone@example.com', status: 'cancelled' },
  ],
  // The same meeting, on a second calendar.
  [TEAM]: [{ ...planning, id: 'planning-copy' }],
  [HOLIDAYS]: [
    { id: 'h1', iCalUID: 'h1@example.com', summary: 'Holiday', start: { date: '2025-01-01' } },
  ],
  [HIDDEN]: [],
};

const CALENDARS = [
  { id: OWNER, summary: OWNER, primary: true, selected: true },
  { id: TEAM, summary: 'Team', summaryOverride: 'Work', selected: true },
  { id: HOLIDAYS, summary: 'Holidays', selected: true },
  { id: HIDDEN, summary: 'Hidden', selected: false },
];

const startOf = event => new Date(event.start?.dateTime ?? event.start?.date ?? 0);
const endOf = event => new Date(event.end?.dateTime ?? event.end?.date ?? startOf(event));

/**
 * As Google lists them: events overlapping `[timeMin, timeMax)` (ending after
 * one, starting before the other), oldest first, at most `maxResults`.
 */
function eventsBetween(events, { timeMin, timeMax, maxResults }) {
  return events
    .filter(event => !timeMin || endOf(event) > new Date(timeMin))
    .filter(event => !timeMax || startOf(event) < new Date(timeMax))
    .toSorted((a, b) => startOf(a) - startOf(b))
    .slice(0, maxResults ? Number(maxResults) : undefined);
}

/**
 * The Calendar API on 127.0.0.1, with the calendar list split over two pages.
 * Every request it saw, with its query, is in the returned list.
 */
export async function fakeCalendar(t) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const query = Object.fromEntries(url.searchParams);
    requests.push({ path: decodeURIComponent(url.pathname), query });
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: {} });
    if (url.pathname === '/users/me/calendarList') {
      return reply(
        200,
        query.pageToken
          ? { items: CALENDARS.slice(2) }
          : { items: CALENDARS.slice(0, 2), nextPageToken: 'more' }
      );
    }
    const events = decodeURIComponent(url.pathname).match(/^\/calendars\/(.+)\/events$/);
    if (events) return reply(200, { items: eventsBetween(EVENTS[events[1]] ?? [], query) });
    reply(404, { error: {} });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const { apiBaseURL } = GoogleCalendarEventsExtractor;
  GoogleCalendarEventsExtractor.apiBaseURL = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    GoogleCalendarEventsExtractor.apiBaseURL = apiBaseURL;
    server.close();
  });
  return requests;
}
