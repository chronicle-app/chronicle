import type { ContactLinks } from '@chronicle.app/google';

/** The parts of the Calendar API's resources the plugin reads. */

export interface CalendarListEntry {
  id: string;
  summary: string;
  summaryOverride?: string;
  primary?: boolean;
  /** Shown in Google Calendar's list. */
  selected?: boolean;
  accessRole?: string;
}

/** A timed event has `dateTime`; an all-day one has `date` (YYYY-MM-DD). */
export interface EventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface EventPerson {
  email?: string;
  displayName?: string;
  /** This is the owner of the calendar this copy of the event is on. */
  self?: boolean;
  organizer?: boolean;
  resource?: boolean;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
}

export interface CalendarEvent {
  id: string;
  /** Shared by every copy of the event, on every guest's calendar. */
  iCalUID: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  /** For an instance of a recurring event: the series, and when this one was due. */
  recurringEventId?: string;
  originalStartTime?: EventTime;
  organizer?: EventPerson;
  creator?: EventPerson;
  attendees?: EventPerson[];
  eventType?: string;
}

/** One extracted record: an event and the calendar it was read from. */
export interface EventRecord {
  event: CalendarEvent;
  calendar: { id: string; summary: string; primary: boolean };
  /** What your contacts link each guest's address to. */
  contacts?: { [address: string]: ContactLinks };
  /** The signed-in account's address: its primary calendar's ID. */
  account?: string;
}
