import { Extractor, Record } from '@chronicle.app/etl';
import {
  ContactDirectory,
  GoogleApi,
  contactOptions,
  googleAccountOptions,
} from '@chronicle.app/google';
import { z } from 'zod';
import GoogleCalendarTransformer, { plannedAt } from './GoogleCalendarTransformer.js';
import type { CalendarEvent, CalendarListEntry, EventRecord } from '../types.js';

/**
 * Public calendars Google adds for you (holidays, contacts' birthdays, week
 * numbers): `…@group.v.calendar.google.com`. Left out unless named.
 */
const GENERATED_CALENDAR = /@group\.v\.calendar\.google\.com$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far past today events are read: plans already made for the coming
 * year are history too, and recurring events need an end to stop expanding.
 */
const LOOKAHEAD_DAYS = 365;

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
  private account: string | undefined;
  private unscheduled = new Set<string>();

  override keyOf(record: Record): string {
    const { calendar, event } = record.data as EventRecord;
    return `${calendar.id}/${event.id}`;
  }

  /** When the event was put on its calendar, as its planning is dated. */
  override occurredAt(record: Record): Date | undefined {
    return plannedAt((record.data as EventRecord).event);
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
    // An account's primary calendar has its address as its ID.
    this.account = all.find(calendar => calendar.primary)?.id.toLowerCase();
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

  /**
   * Events newest first by when they were put on a calendar, across every
   * calendar. Google lists events only by when they start or were changed,
   * so each calendar is read whole and the run sorted before anything goes
   * out; `--since` and `--until` bound when an event was created.
   */
  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof GoogleCalendarEventsExtractor.schema>;
    const until = new Date(Date.now() + LOOKAHEAD_DAYS * DAY_MS);
    const records: Record[] = [];
    for (const calendar of this.calendars) {
      for await (const event of this.eventsUntil(calendar, until)) {
        const at = plannedAt(event);
        if (config.since && at < config.since) continue;
        if (config.until && at >= config.until) continue;
        records.push(this.createRecord(this.recordOf(event, calendar), { recordType: 'events' }));
      }
    }
    // Occurrences of a recurring event share when it was created; the latest
    // goes first. Stable, so the rest keep the calendars' order.
    const created = (record: Record) => this.occurredAt(record)!.getTime();
    const starts = (record: Record) => startOf((record.data as EventRecord).event)!.getTime();
    records.sort((a, b) => created(b) - created(a) || starts(b) - starts(a));
    let count = 0;
    for (const record of records) {
      yield record;
      if (this.shouldStopExtracting(++count)) return;
    }
    if (this.unscheduled.size > 0) {
      this.logger.warn(`Skipped ${this.unscheduled.size} event(s) with no start`);
    }
  }

  /**
   * A calendar's events starting before `end`. singleEvents expands
   * recurring events into their occurrences, each with its own start.
   */
  private async *eventsUntil(calendar: CalendarListEntry, end: Date) {
    const events = this.api.pages<CalendarEvent>(eventsPath(calendar), {
      singleEvents: true,
      maxResults: 2500,
      timeMax: end.toISOString(),
    });
    for await (const event of events) {
      if (event.status === 'cancelled') continue;
      // iCalendar requires a start for an event on a calendar; one without
      // has nothing to place it by.
      if (!event.start?.dateTime && !event.start?.date) {
        this.unscheduled.add(event.id);
        continue;
      }
      yield event;
    }
  }

  private recordOf(event: CalendarEvent, calendar: CalendarListEntry): EventRecord {
    const people = [event.organizer, event.creator, ...(event.attendees ?? [])];
    return {
      // The calendar's ID too: an account's own calendar has its owner's
      // address, who's the agent of an event that names no one.
      contacts: this.contacts.linksFor([
        ...people.flatMap(person => (person?.email ? [person.email] : [])),
        calendar.id,
      ]),
      event,
      calendar: {
        id: calendar.id,
        summary: calendar.summaryOverride ?? calendar.summary,
        primary: calendar.primary ?? false,
      },
      ...(this.account && { account: this.account }),
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
