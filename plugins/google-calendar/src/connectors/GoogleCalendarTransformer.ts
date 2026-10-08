import { ChronicleTransformer, Record, htmlToMarkdown, tidyText } from '@chronicle.app/etl';
import { contactIdentities, googleAccount, type ContactLinks } from '@chronicle.app/google';
import { ActionAndChildren, Agent, Calendar, Event, PlanAction } from '@chronicle.app/schema';
import type { CalendarEvent, EventPerson, EventRecord, EventTime } from '../types.js';

const source = 'google-calendar';
/**
 * The iCalendar UID's namespace (RFC 5545): the identity every copy of a
 * meeting shares, in any account or calendar provider. The planning, which
 * happened once, is keyed by it; each calendar's copy is `sameAs` it.
 */
const ICALENDAR = 'icalendar';

type Contacts = { [address: string]: ContactLinks };
/** What the people on one calendar's copy of an event are read against. */
interface Context {
  calendar: EventRecord['calendar'];
  contacts: Contacts;
  /** The signed-in account's address. */
  account?: string;
}

/**
 * IDs Google gives calendars that aren't an account's own: ones made in an
 * account, subscribed and holiday calendars, rooms. An account's own (primary)
 * calendar has its address as its ID.
 */
const CALENDAR_ID = /\.calendar\.google\.com$/i;

export default class GoogleCalendarTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'events') return [];
    const { event, calendar, contacts = {}, account } = record.data as EventRecord;
    // Without a start, it isn't an event on a calendar (the extractor skips it).
    if (!startOf(event.start)) return [];
    const context: Context = {
      calendar,
      contacts,
      account: account ?? (calendar.primary ? calendar.id.toLowerCase() : undefined),
    };

    // Who put it on the calendar, always someone: its organizer, unless
    // that's a calendar (Google makes a calendar the organizer of events
    // created on it), else its creator, else the calendar's owner when it's
    // an account's own calendar, else (an event with neither, on a calendar
    // made in an account) the calendar itself.
    const person = (who?: EventPerson) =>
      who?.email && !CALENDAR_ID.test(who.email) ? who : undefined;
    const organizer =
      this.buildAgent(person(event.organizer), context) ??
      this.buildAgent(person(event.creator), context) ??
      this.buildAgent(person({ email: calendar.id }), context) ??
      this.calendarAgent(calendar);

    const plan: PlanAction = {
      '@type': 'PlanAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: ICALENDAR,
      sourceId: identityOf(event),
      // When it was put on the calendar; the event carries when it happens.
      timestamp: plannedAt(event),
      agent: organizer,
      object: this.buildEvent(event, context),
    };
    return [plan];
  }

  private buildEvent(event: CalendarEvent, context: Context): Event {
    const { calendar } = context;
    const attendees = (event.attendees ?? [])
      // Rooms and equipment booked for the event aren't guests.
      .filter(attendee => !attendee.resource)
      .map(attendee => this.buildAgent(attendee, context))
      .filter((agent): agent is Agent => agent !== null);
    // Google keeps a description as the HTML its editor wrote; Markdown here.
    const description = tidyText(htmlToMarkdown(event.description) ?? '');
    const { startTime, endTime } = scheduleOf(event);
    // This calendar's copy of the event, by Google's own ID for it (the `eid`
    // its links carry), `sameAs` the iCalendar UID every copy shares.
    return {
      '@type': 'Event',
      '@key': ['@type', 'source', 'sourceId'],
      source,
      sourceId: eidOf(event, calendar),
      sameAs: [
        {
          '@type': 'Event',
          '@key': ['@type', 'source', 'sourceId'],
          source: ICALENDAR,
          sourceId: identityOf(event),
        },
      ],
      ...(event.summary && { name: event.summary }),
      ...(description && { description }),
      // When it's planned for: facts about the plan, not something that
      // happened. Times that happen belong to actions.
      scheduledStart: startTime,
      scheduledEnd: endTime,
      ...(event.location && { location: { '@type': 'Location', address: event.location } }),
      isPartOf: [calendarCollection(calendar)],
      ...(attendees.length > 0 && { attendee: attendees }),
    };
  }

  /** A calendar made in an account, as the agent of an event no one is named for. */
  private calendarAgent(calendar: EventRecord['calendar']): Agent {
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'sourceId'],
      source,
      sourceId: calendar.id,
      name: calendar.summary,
    };
  }

  /**
   * A person on the event by their email address, in the `email` namespace
   * as mail keys them (lowercased), so a guest and the person who emails you
   * are one node. You are `@me` and the signed-in Google account: at the
   * account's address, or as the guest Google marks as your primary
   * calendar's owner (an alias). On a calendar shared with you, that mark is
   * the calendar's owner, who can be someone else.
   */
  private buildAgent(person: EventPerson | undefined, context: Context): Agent | null {
    if (!person?.email) return null;
    const handle = person.email.toLowerCase();
    const { account, calendar, contacts } = context;
    const you = handle === account || (Boolean(person.self) && calendar.primary);
    // You, and the other addresses and numbers your contacts have for them.
    const sameAs: NonNullable<Agent['sameAs']> = [
      ...(you ? ['@me', ...(account ? [googleAccount(account)] : [])] : []),
      ...contactIdentities(handle, contacts[handle]),
    ];
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'email',
      handle,
      name: person.displayName || handle,
      ...(sameAs.length > 0 && { sameAs }),
    };
  }
}

/**
 * The event's iCalendar UID, the same on every guest's calendar, so an event
 * on two of your calendars is one event. Instances of a recurring event share
 * the series' UID and differ by when each was due.
 */
function identityOf(event: CalendarEvent): string {
  const due = event.originalStartTime;
  // As an instant (UTC), so the same occurrence on calendars in different
  // time zones, written with different offsets, is one event.
  const at = due?.dateTime ? new Date(due.dateTime).toISOString() : due?.date;
  return event.recurringEventId && at ? `${event.iCalUID}@${at}` : event.iCalUID;
}

const startOf = (time: EventTime | undefined) => time?.dateTime ?? time?.date;

/**
 * When an event was put on its calendar: Google's `created`, else when it
 * was last changed, else (neither, which Google always gives) its start.
 * Extraction is ordered by it too.
 */
export function plannedAt(event: CalendarEvent): Date {
  return new Date(event.created ?? event.updated ?? startOf(event.start)!);
}

/**
 * When an event is planned for, both bounds always: instants for a timed
 * event, civil dates for an all-day one. Google (like iCalendar) writes an
 * all-day event's end as the day after its last; a `Date` end bound is the
 * last day included, so a one-day event is that day to that day. With no end,
 * iCalendar's rule: an all-day event lasts its one day, a timed one ends as it
 * starts.
 */
function scheduleOf(event: CalendarEvent): { startTime: Date | string; endTime: Date | string } {
  if (event.start?.dateTime) {
    const startTime = new Date(event.start.dateTime);
    const endTime = event.end?.dateTime ? new Date(event.end.dateTime) : startTime;
    return { startTime, endTime };
  }
  const startTime = event.start!.date!;
  const lastDay = event.end?.date ? dayBefore(event.end.date) : startTime;
  return { startTime, endTime: lastDay < startTime ? startTime : lastDay };
}

/** The civil date before `date` (YYYY-MM-DD), by the calendar, not a clock. */
function dayBefore(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Google's ID for one calendar's copy of an event: the `eid` in its link,
 * base64 of the event ID and the calendar ID. Read from the link, or made the
 * same way when there's none.
 */
function eidOf(event: CalendarEvent, calendar: EventRecord['calendar']): string {
  const fromLink = event.htmlLink && new URL(event.htmlLink).searchParams.get('eid');
  return fromLink || Buffer.from(`${event.id} ${calendar.id}`).toString('base64url');
}

/** The calendar its events are on, by Google's calendar ID. */
function calendarCollection(calendar: EventRecord['calendar']): Calendar {
  return {
    '@type': 'Calendar',
    '@key': ['@type', 'source', 'sourceId'],
    source,
    sourceId: calendar.id,
    name: calendar.summary,
  };
}
