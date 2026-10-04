import { ChronicleTransformer, Record, htmlToMarkdown, tidyText } from '@chronicle.app/etl';
import { contactIdentities, type ContactLinks } from '@chronicle.app/google';
import { ActionAndChildren, Agent, Event, PlanAction } from '@chronicle.app/schema';
import type { CalendarEvent, EventPerson, EventRecord, EventTime } from '../types.js';

const source = 'google-calendar';

type Contacts = { [address: string]: ContactLinks };

export default class GoogleCalendarTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'events') return [];
    const { event, contacts = {} } = record.data as EventRecord;

    const organizer = this.buildAgent(event.organizer ?? event.creator, contacts);
    if (!organizer) {
      throw new Error(`Event ${event.id} has no organizer or creator with an email`);
    }

    const plan: PlanAction = {
      '@type': 'PlanAction',
      '@key': ['@type', 'source', 'sourceId'],
      source,
      sourceId: identityOf(event),
      // When it was put on the calendar; the event carries when it happens.
      timestamp: new Date(event.created ?? event.updated ?? startOf(event.start)!),
      agent: organizer,
      object: this.buildEvent(event, contacts),
    };
    return [plan];
  }

  private buildEvent(event: CalendarEvent, contacts: Contacts): Event {
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
      source,
      sourceId: identityOf(event),
      ...(event.summary && { name: event.summary }),
      ...(description && { description }),
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
      ...(event.location && { location: { '@type': 'Location', address: event.location } }),
      ...(event.htmlLink && { url: event.htmlLink }),
      ...(attendees.length > 0 && { attendee: attendees }),
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
