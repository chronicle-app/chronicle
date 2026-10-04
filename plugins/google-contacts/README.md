# @chronicle.app/google-contacts

Your Google Contacts, through the [People API](https://developers.google.com/people/api/rest/v1/people.connections/list).

## Usage

```sh
chronicle auth login google --add contacts
chronicle extract google-contacts
chronicle extract google-contacts --since 2025-01-01
```

Sign in first: see [@chronicle.app/google](../../core/google/README.md). Contacts isn't asked for on a first sign-in; `--add contacts` adds it to what you have and turns the People API on in your project.

Contacts come most recently edited first. `--since` reads the contacts you've edited since then.

## Schema

| Contacts thing            | Chronicle node | Key                                               | Properties                                                                                                 |
| ------------------------- | -------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Your last edit            | `UpdateAction` | `@type`, `source`, `object.sourceId`, `timestamp` | `agent` (you), `object` (the `Person`), `timestamp` (when you last edited it)                              |
| A contact                 | `Person`       | `@type`, `source`, `sourceId`                     | `name`, `description` (notes, as Markdown), `url`, `emblem` (photo), `memberOf`, `tags` (labels), `sameAs` |
| Its organization          | `Organization` | `@type`, `source`, `name`                         | `name`                                                                                                     |
| Its addresses and numbers | `Agent`        | `@type`, `source` (`email` or `phone`), `handle`  | the identities other sources key a person by                                                               |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**There's no history to read, so each run reads what's there now.** Google keeps no record of when you added, edited, or last contacted someone: a contact says only when your card for it last changed. That includes bulk changes (an import, a phone sync, a merge), so many contacts can share one date. The person's own Google profile changes on its own, when they change their photo or name, so its time isn't used. Each contact arrives on the `UpdateAction` of that edit, and a later edit is a new action, so running the extraction over time builds a history of your edits. (The People API's sync tokens list what changed since the last read, deletions included, but expire after 7 days; Chronicle doesn't keep a cursor for them yet.)

**A contact links to the people other sources see.** Its email addresses, lowercased, are `sameAs` the `email` identities mail, calendars, and messages key people by, and its phone numbers, in E.164, are `sameAs` the `phone` identities messages and calls use. That's what puts a contact's name on the person who emails you, invites you, or texts you.

**Labels are tags; only a current organization is kept.** Your own labels, and Starred, Friends, Family, and Coworkers, are the person's `tags`; "My Contacts", which every contact is in, isn't. A past organization isn't where they are now, so it's left out.

**Notes are Markdown.** A contact's notes come as plain text or HTML; HTML is converted, and tracking parameters come off links.

## Tests

The tests run against a fake People API on 127.0.0.1 with synthetic contacts, and pass the access token directly. They never read stored credentials or reach Google.
