import { ChronicleTransformer, Record, htmlToMarkdown, tidyText } from '@chronicle.app/etl';
import { contactIdentities, type ContactLinks } from '@chronicle.app/google';
import { ActionAndChildren, Agent, Collection, Event, PlanAction } from '@chronicle.app/schema';
import type { CalendarEvent, EventPerson, EventRecord, EventTime } from '../types.js';

const source = 'google-calendar';
/**
 * Events and their planning are keyed by the iCalendar UID in the protocol's
 * own namespace (RFC 5545), so a meeting is one node whichever account or
 * calendar provider it was read from.
 */
const ICALENDAR = 'icalendar';

type Contacts = { [address: string]: ContactLinks };

export default class GoogleCalendarTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'events') return [];
    const { event, calendar, contacts = {} } = record.data as EventRecord;

    // Who put it on the calendar: its organizer, else its creator, else (an
    // event with neither, like one copied in) the calendar itself.
    const organizer =
      this.buildAgent(event.organizer, contacts) ??
      this.buildAgent(event.creator, contacts) ??
      this.calendarAgent(calendar);

    const plan: PlanAction = {
      '@type': 'PlanAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: ICALENDAR,
      sourceId: identityOf(event),
      // When it was put on the calendar; the event carries when it happens.
      timestamp: new Date(event.created ?? event.updated ?? startOf(event.start)!),
      agent: organizer,
      object: this.buildEvent(event, calendar, contacts),
    };
    return [plan];
  }

  private buildEvent(
    event: CalendarEvent,
    calendar: EventRecord['calendar'],
    contacts: Contacts
  ): Event {
    const attendees = (event.attendees ?? [])
      // Rooms and equipment booked for the event aren't guests.
      .filter(attendee => !attendee.resource)
      .map(attendee => this.buildAgent(attendee, contacts))
      .filter((agent): agent is Agent => agent !== null);
    // Google keeps a description as the HTML its editor wrote; Markdown here.
    const description = tidyText(htmlToMarkdown(event.description) ?? '');
    const startTime = timeOf(event.start);
    const endTime = timeOf(event.end);
    return {
      '@type': 'Event',
      '@key': ['@type', 'source', 'sourceId'],
      source: ICALENDAR,
      sourceId: identityOf(event),
      ...(event.summary && { name: event.summary }),
      ...(description && { description }),
      // When it's planned for: a declared interval, not something that
      // happened. Times that happen belong to actions.
      ...((startTime || endTime) && {
        scheduledTime: {
          '@type': 'Interval',
          ...(startTime && { startTime }),
          ...(endTime && { endTime }),
        },
      }),
      ...(event.location && { location: { '@type': 'Location', address: event.location } }),
      // Google's link opens one calendar's copy, so it isn't the event's:
      // the event is on each calendar it was read from instead.
      isPartOf: [calendarCollection(calendar)],
      ...(attendees.length > 0 && { attendee: attendees }),
    };
  }

  /** A calendar as the agent of its own event: yours (`@me`) when it's your primary one. */
  private calendarAgent(calendar: EventRecord['calendar']): Agent {
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'sourceId'],
      source,
      sourceId: calendar.id,
      name: calendar.summary,
      ...(calendar.primary && { sameAs: ['@me'] }),
    };
  }

  /**
   * A person on the event by their email address, in the `email` namespace
   * as mail keys them (lowercased), so a guest and the person who emails you
   * are one node. Marked as the owner when it's the signed-in account.
   */
  private buildAgent(person: EventPerson | undefined, contacts: Contacts): Agent | null {
    if (!person?.email) return null;
    const handle = person.email.toLowerCase();
    // You, and the other addresses and numbers your contacts have for them.
    const sameAs: NonNullable<Agent['sameAs']> = [
      ...(person.self ? ['@me'] : []),
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

/** An instant for a timed event; the civil date string for an all-day one. */
function timeOf(time: EventTime | undefined): Date | string | undefined {
  if (time?.dateTime) return new Date(time.dateTime);
  return time?.date;
}

/** A calendar as the collection its events are on, by Google's calendar ID. */
function calendarCollection(calendar: EventRecord['calendar']): Collection {
  return {
    '@type': 'Collection',
    '@key': ['@type', 'source', 'sourceId'],
    source,
    sourceId: calendar.id,
    name: calendar.summary,
  };
}
