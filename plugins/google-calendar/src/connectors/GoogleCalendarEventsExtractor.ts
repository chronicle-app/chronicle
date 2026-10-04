import { Extractor, Record } from '@chronicle.app/etl';
import {
  ContactDirectory,
  GoogleApi,
  contactOptions,
  googleAccountOptions,
} from '@chronicle.app/google';
import { z } from 'zod';
import GoogleCalendarTransformer from './GoogleCalendarTransformer.js';
import type { CalendarEvent, CalendarListEntry, EventRecord } from '../types.js';

/**
 * Public calendars Google adds for you (holidays, contacts' birthdays, week
 * numbers): `…@group.v.calendar.google.com`. Left out unless named.
 */
const GENERATED_CALENDAR = /@group\.v\.calendar\.google\.com$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far past today a run reads by default: upcoming plans are history too. */
const DEFAULT_LOOKAHEAD_DAYS = 365;

/**
 * How much time each read covers, walking back from the newest. Google only
 * sorts events oldest first, so each window is read whole and reversed.
 */
const WINDOW_DAYS = 90;

export class GoogleCalendarEventsExtractor extends Extractor<typeof GoogleCalendarEventsExtractor> {
  static override source = 'google-calendar';
  static override description = 'Events on your Google calendars';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = ['events'];
  static override default = true;
  static override newestFirst = true;
  static override defaultTransformer = GoogleCalendarTransformer;
  /** Swapped for a fake server in tests. */
  static apiBaseURL = 'https://www.googleapis.com/calendar/v3';

  static override schema = Extractor.schema.extend({
    ...googleAccountOptions,
    ...contactOptions,
    calendar: z
      .string()
      .optional()
      .describe('Calendar IDs to extract, comma-separated. The default is every calendar shown.'),
  });

  private api!: GoogleApi;
  private calendars: CalendarListEntry[] = [];
  private contacts = ContactDirectory.empty;

  override keyOf(record: Record): string {
    const { calendar, event } = record.data as EventRecord;
    return `${calendar.id}/${event.id}`;
  }

  override occurredAt(record: Record): Date | undefined {
    return startOf((record.data as EventRecord).event);
  }

  override async setup(): Promise<void> {
    await super.setup();
    const config = this.config as z.infer<typeof GoogleCalendarEventsExtractor.schema>;
    this.api = new GoogleApi({
      service: 'calendar',
      baseURL: GoogleCalendarEventsExtractor.apiBaseURL,
      account: config.account,
      accessToken: config.accessToken,
    });
    await this.api.initialize();

    const all: CalendarListEntry[] = [];
    for await (const calendar of this.api.pages<CalendarListEntry>('/users/me/calendarList')) {
      all.push(calendar);
    }
    const named = config.calendar?.split(',').map(id => id.trim());
    this.calendars = named
      ? all.filter(calendar => named.includes(calendar.id))
      : all.filter(calendar => calendar.selected && !GENERATED_CALENDAR.test(calendar.id));
    const { directory, missing } = await ContactDirectory.load({
      account: config.account,
      accessToken: config.accessToken,
      linkContacts: config.linkContacts,
    });
    this.contacts = directory;
    if (missing) {
      this.hint('Your contacts aren’t linked to these guests', {
        action: 'Run `chronicle auth login google --add contacts` to link them.',
      });
    }
    this.logger.debug('Calendars to extract', {
      calendars: this.calendars.map(calendar => calendar.summary),
    });
  }

  /** Events newest first, across every calendar, by when they start. */
  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof GoogleCalendarEventsExtractor.schema>;
    const until = config.until ?? new Date(Date.now() + DEFAULT_LOOKAHEAD_DAYS * DAY_MS);
    const since = config.since ?? (await this.earliestStart());
    if (!since) return;
    let count = 0;
    // Each window's read reaches a day past it on either side, inside the
    // run's own bounds: Google places an all-day event by the calendar's
    // time zone, and an event that ends where it starts by its start, so a
    // read that stops exactly at a window's edge can miss one. An event read
    // in two windows is kept from the first.
    const seen = new Set<string>();
    const reach = (at: number) =>
      new Date(Math.min(until.getTime(), Math.max(since.getTime(), at)));

    for (let end = until; end > since;) {
      const start = new Date(Math.max(since.getTime(), end.getTime() - WINDOW_DAYS * DAY_MS));
      const from = reach(start.getTime() - DAY_MS);
      const to = reach(end.getTime() + DAY_MS);
      const records: Record[] = [];
      for (const calendar of this.calendars) {
        for await (const event of this.eventsIn(calendar, from, to)) {
          const record = this.createRecord(this.recordOf(event, calendar), {
            recordType: 'events',
          });
          const key = this.keyOf(record);
          if (seen.has(key)) continue;
          seen.add(key);
          records.push(record);
        }
      }
      // Stable, so events starting together keep the calendars' order.
      records.sort((a, b) => this.occurredAt(b)!.getTime() - this.occurredAt(a)!.getTime());
      for (const record of records) {
        yield record;
        if (this.shouldStopExtracting(++count)) return;
      }
      end = start;
    }
  }

  /** The start of the earliest event on any calendar, where a full read stops. */
  private async earliestStart(): Promise<Date | undefined> {
    let earliest: Date | undefined;
    for (const calendar of this.calendars) {
      const page = await this.api.get<{ items?: CalendarEvent[] }>(eventsPath(calendar), {
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 1,
      });
      const at = page.items?.[0] && startOf(page.items[0]);
      if (at && (!earliest || at < earliest)) earliest = at;
    }
    return earliest;
  }

  /**
   * A calendar's events overlapping `[start, end)`. singleEvents expands
   * recurring events into their occurrences, each with its own start.
   */
  private async *eventsIn(calendar: CalendarListEntry, start: Date, end: Date) {
    const events = this.api.pages<CalendarEvent>(eventsPath(calendar), {
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
    });
    for await (const event of events) {
      if (event.status !== 'cancelled') yield event;
    }
  }

  private recordOf(event: CalendarEvent, calendar: CalendarListEntry): EventRecord {
    const people = [event.organizer, event.creator, ...(event.attendees ?? [])];
    return {
      contacts: this.contacts.linksFor(
        people.flatMap(person => (person?.email ? [person.email] : []))
      ),
      event,
      calendar: {
        id: calendar.id,
        summary: calendar.summaryOverride ?? calendar.summary,
        primary: calendar.primary ?? false,
      },
    };
  }

  override recordToString(data?: EventRecord): string {
    return data?.event?.summary ?? 'google-calendar.events';
  }
}

const eventsPath = (calendar: CalendarListEntry) =>
  `/calendars/${encodeURIComponent(calendar.id)}/events`;

/** When an event starts: its instant, or midnight UTC of an all-day event's date. */
function startOf(event: CalendarEvent): Date | undefined {
  const at = event.start?.dateTime ?? event.start?.date;
  return at ? new Date(at) : undefined;
}
