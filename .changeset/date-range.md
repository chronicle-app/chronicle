---
'@chronicle.app/schema': minor
'@chronicle.app/persistence': minor
'@chronicle.app/google-calendar': minor
---

The vocabulary adds `DateRange`, a datatype for a stretch of time, all of it included: a date, such as `2026-05`, or an interval, such as `2026-05-04/2026-05-10` or `2026-05-14T16:00:00Z/2026-05-14T17:00:00Z`. `isDateRange` checks a string. A `DateTime` stays one moment, so `2026-05` as a `datePublished` is some moment in May, and as a `dateCovered` it's all of May.

A `CreativeWork` can have a `dateCovered`, the period it's about, such as the day a journal entry describes or the years a novel is set in.

`scheduledFor` takes the place of `scheduledStart` and `scheduledEnd` on an `Event`, so a plan changes as one value. A `Session` no longer has a planned period: it's what a person actually did, and a plan for it is an `Event` it can be part of. Google Calendar writes it: two instants for a timed event, and a date or two for an all-day one. Import your calendars again to give events already in a store a `scheduledFor`.
