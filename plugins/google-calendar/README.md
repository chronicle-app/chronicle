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

A run reads every calendar shown in your Google Calendar list, except the ones Google adds for you (holidays, contacts' birthdays). `--calendar` names others, comma-separated, by their IDs. Each recurring event is read as its separate occurrences. Events come out newest first by when they were put on a calendar, as their planning is dated, and `--since` and `--until` bound that date. Google lists events only by when they start or were changed, so a run reads each calendar whole, up to a year ahead (upcoming plans are history too), and sorts before the first event comes out. The occurrences of a recurring event share when it was created. Cancelled events are left out.

## Schema

| Calendar thing         | Chronicle node | Key                                                             | Properties                                                                                                                                                                                                                 |
| ---------------------- | -------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An event on a calendar | `PlanAction`   | `@type`, `source`, `sourceId`                                   | `agent` (who put it on the calendar), `object` (the `Event`), `timestamp` (when it was put on the calendar)                                                                                                                |
| The event              | `Event`        | `@type`, `source` (`icalendar`), `sourceId` (its UID)           | `sameAs` (each calendar's copy, by its `eid`), `name`, `description` (Markdown), `scheduledStart`, `scheduledEnd`, `location` (a `Location` with the `address` as written), `attendee`, `isPartOf` (each calendar it's on) |
| A person on it         | `Agent`        | `@type`, `source` (`email`), `handle` (their email, lowercased) | `alternateName` (what an invitation called them); you are `sameAs` `@me` and your Google account                                                                                                                           |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**An event is its iCalendar UID, wherever it's read.** The event and the planning of it are keyed by its UID, in the `icalendar` namespace, as a message is keyed by its Message-ID. The UID is defined by the protocol (RFC 5545) and is the same on every guest's calendar and in every provider an invitation reaches, so a meeting on two of your calendars, in two of your accounts, or later from another calendar provider is one event, `isPartOf` each calendar it's on. Each calendar's copy is `sameAs` the event, keyed by Google's own ID for it, the `eid` its link carries. Each occurrence of a recurring event has the series' UID and is identified by it and when that occurrence was due (`<uid>@<original start>`), so moving one occurrence keeps it the same event. Planning it happened once, so the `PlanAction` is keyed by the UID too. The plugin declares a `deepLinks` template for a calendar's copy of an `Event` (`https://www.google.com/calendar/event?eid=<eid>`), so a host can open the copy in Google Calendar.

**An event has no URL; it's on its calendars.** Google's event link encodes one calendar's copy (its event ID and calendar ID), so the same meeting has a different link on each calendar, and only someone who can see that calendar can open it. The event is instead `isPartOf` a `Calendar` for each calendar it was read from, keyed by Google's calendar ID. An account's own (primary) calendar has the account's address as its ID, so it's `inAccount` that Google account, whoever's list it was read from: a calendar shared with you is its owner's, not yours. A calendar made in an account (`…@group.calendar.google.com`), a subscribed or holiday calendar, or a room doesn't say whose it is, so it has no `inAccount`. The link stays in the raw record.

**When it's planned for are facts about the event.** An event's `scheduledStart` and `scheduledEnd` say when it's planned, not that anything happened, so they aren't `startTime`/`endTime`, which belong to actions. It always has both: instants for a timed event, and civil dates for an all-day one, ending on its last day (Google writes the day after, so a March 14 event is `2025-03-14` to `2025-03-14`). An event with no end gets iCalendar's: an all-day event lasts its one day, and a timed one ends as it starts. An event with no start isn't on a calendar, and is skipped.

**Every event has an agent: who put it on the calendar.** That's its organizer, unless the organizer is a calendar (Google makes a calendar the organizer of events created on it), and then its creator. With neither, it's the calendar's owner when the calendar is an account's own, whose ID is the account's address, and otherwise, on a calendar made in an account, the calendar itself.

**You are the signed-in account.** The account's address, its primary calendar's ID, is you wherever it appears, `sameAs` `@me` and the Google account at that address (the node Gmail and Chrome link you to). So is a guest Google marks as your primary calendar's owner, which is you under an alias. Google marks the owner of whichever calendar a copy is on, so on a calendar shared with you, even one of your other accounts', that owner isn't you here.

**A person is their email address, wherever it's seen.** People are keyed by lowercased address in the `email` namespace, as the mail plugins key them, so a guest at your meeting and the person who emails you are one node.

**Your contacts can link guests.** With `--link-contacts` (and `chronicle auth login google --add contacts`), a guest on one of your contacts is `sameAs` your contact: the entry in your Google account's contacts, keyed by its ID there and named as you saved it, which is `sameAs` the contact's other addresses and phone numbers.

**A description is Markdown.** Google keeps an event's description as the HTML its editor wrote; it's converted to Markdown, with tracking parameters taken off links and long click-tracking redirects dropped.

**Guests are attendees, whatever they answered.** Rooms and equipment booked for the event are left out. Answers (accepted, declined) aren't recorded yet: Google doesn't say when someone answered, so they can't be dated actions.

## Tests

The tests run against a fake Calendar API on 127.0.0.1 with synthetic calendars and people, and pass the access token directly. They never read stored credentials or reach Google.
