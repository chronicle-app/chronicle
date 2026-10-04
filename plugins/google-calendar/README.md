# @chronicle.app/google-calendar

The events on your Google calendars, through the [Calendar API](https://developers.google.com/workspace/calendar/api/v3/reference).

## Usage

```sh
chronicle auth login google
chronicle extract google-calendar
chronicle extract google-calendar --since 2024-01-01 --until 2025-01-01
chronicle extract google-calendar --calendar you@example.com --account you@example.com
```

Sign in first: see [@chronicle.app/google](../../core/google/README.md), which walks you through making your own Google client.

A run reads every calendar shown in your Google Calendar list, except the ones Google adds for you (holidays, contacts' birthdays). `--calendar` names others, comma-separated, by their IDs. Each recurring event is read as its separate occurrences. Without `--until`, a run reads a year ahead, since upcoming plans are history too. Cancelled events are left out.

## Schema

| Calendar thing         | Chronicle node | Key                                                             | Properties                                                                                                                                                                 |
| ---------------------- | -------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An event on a calendar | `PlanAction`   | `@type`, `source`, `sourceId`                                   | `agent` (the organizer), `object` (the `Event`), `timestamp` (when it was put on the calendar)                                                                             |
| The event              | `Event`        | `@type`, `source` (`icalendar`), `sourceId` (the UID)           | `name`, `description` (Markdown), `scheduledTime` (an `Interval`), `location` (a `Location` with the `address` as written), `attendee`, `isPartOf` (each calendar it's on) |
| A person on it         | `Agent`        | `@type`, `source` (`email`), `handle` (their email, lowercased) | `name`; you are `sameAs` `@me`                                                                                                                                             |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**An event is keyed by its iCalendar UID, in the `icalendar` namespace.** The UID is defined by the protocol (RFC 5545) and is the same on every guest's calendar and in every provider an invitation reaches, so a meeting on two of your calendars, in two of your accounts, or later from another calendar provider is one event. Each occurrence of a recurring event has the series' UID and is keyed by it and when that occurrence was due (`<uid>@<original start>`), so moving one occurrence keeps it the same event.

**An event has no URL; it's on its calendars.** Google's event link encodes one calendar's copy (its event ID and calendar ID), so the same meeting has a different link on each calendar, and only someone who can see that calendar can open it. The event is instead `isPartOf` a `Collection` for each calendar it was read from, keyed by Google's calendar ID. The link stays in the raw record.

**When it's planned for is a declared interval.** An event's `scheduledTime` is an `Interval`: instants for a timed event, and civil dates (`2025-03-14`) for an all-day one, with Google's exclusive end date. `startTime` and `endTime` belong to actions, things that happened; a calendar entry only says when something is planned.

**A person is their email address, wherever it's seen.** People are keyed by lowercased address in the `email` namespace, as the mail plugins key them, so a guest at your meeting and the person who emails you are one node.

**Your contacts can link guests.** With `--link-contacts` (and `chronicle auth login google --add contacts`), a guest on one of your contacts is `sameAs` the contact's other addresses and phone numbers.

**A description is Markdown.** Google keeps an event's description as the HTML its editor wrote; it's converted to Markdown, with tracking parameters taken off links and long click-tracking redirects dropped.

**Guests are attendees, whatever they answered.** Rooms and equipment booked for the event are left out. Answers (accepted, declined) aren't recorded yet: Google doesn't say when someone answered, so they can't be dated actions.

## Tests

The tests run against a fake Calendar API on 127.0.0.1 with synthetic calendars and people, and pass the access token directly. They never read stored credentials or reach Google.
