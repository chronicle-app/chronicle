# LinkedIn plugin

Reads the **member data export** — the ZIP that Settings & Privacy → Data
Privacy → "Get a copy of your data" produces, unpacked to a directory.

```bash
chronicle extract linkedin --input ~/Downloads/Basic_LinkedInDataExport_08-08-2026 --limit 0
chronicle extract linkedin --input <dir> --type messages --limit 5   # one record kind
```

`--limit 0` means no limit. The export is small enough to read end to end.

## Why the export and not an API

LinkedIn's only programmatic route to your own data is **Member Data
Portability (Member)**, built for the EU Digital Markets Act: a Snapshot API
for history and a Changelog API for live interactions. Only members located in
the EEA or Switzerland can consent and mint a token. The ordinary LinkedIn API
returns your name, photo and email — no posts, no activity. There is no RSS.

Even where the API is open, its changelog only answers for the last 28 days and
only from the moment you consent, so the export stays the only route to
history.

## Two archives

LinkedIn builds two. The **fast** archive arrives in minutes with your profile,
network, and messages — that is what this plugin was written against. The
**full** archive takes up to a day and adds your activity: `Shares.csv`,
`Comments.csv`, `Reactions.csv`. Those three are not read yet.

Every extractor treats a missing file as an empty one, so a fast archive simply
yields fewer record types than a full one.

## What it reads

| File                                    | `--type`       | Becomes                                            |
| --------------------------------------- | -------------- | -------------------------------------------------- |
| `messages.csv`                          | `messages`     | `MessageAction` → `Message`, `isPartOf` a `Thread` |
| `Connections.csv`                       | `connections`  | `FollowAction` → `Person` (see below)              |
| `Endorsement_{Given,Received}_Info.csv` | `endorsements` | `RespondAction` → `Response` about a `DefinedTerm` |
| `Company Follows.csv`                   | `follows`      | `FollowAction` → `Organization`                    |
| `Positions.csv`                         | `positions`    | `JoinAction`/`LeaveAction` over a `Tenure`         |
| `Education.csv`                         | `education`    | `JoinAction`/`LeaveAction` over an `Enrollment`    |
| `Learning.csv`                          | `learning`     | `WatchAction`, `CompleteAction`, `BookmarkAction`  |
| `Profile.csv`, `Email Addresses.csv`    | `profile`      | `UpdateAction` → the self `Person`                 |

A bare run merges all eight newest-first (`LinkedInDefaultExtractor`).

## Identity

**People key on the vanity slug** out of `/in/<slug>`. LinkedIn never puts a
member's numeric id in an export, so this is the only identifier there is. It
is user-changeable, which makes it imperfect — a member who renames their
profile arrives in the next export as someone new — but the alternative is
keying strangers on their display name. Each person also carries their profile
URL, which mints the portable url-namespace identity that merges them with the
same page seen from any other source.

**You** come from `Profile.csv` for the name and headline and from
`Email Addresses.csv` for the primary address, which rides as a `sameAs` in the
`email` namespace — evidence that merges your LinkedIn self with the self your
mail and messaging plugins already know.

Your own **profile URL is not in `Profile.csv`**; LinkedIn omits it. It appears
only in `Invitations.csv`, which carries both parties' URLs _and_ a `Direction`
column — so an `OUTGOING` row states outright that the inviter is you. That is
the source declaring it, not a name match. Failing that, pass `--profile-url`;
failing that too, the self falls back to the per-source singleton. All three
routes still merge onto one person through `@me`.

**Organizations key on their name.** There is no company id anywhere in an
export, so two different companies sharing a name will merge.

**Messages have no id of their own.** LinkedIn ships the conversation id, the
moment, the sender and the text. The `Thread` keys on that conversation id; a
`Message` keys on the natural tuple. Two messages with identical text from one
person in one thread therefore resolve to a single `Message` — though their
sends stay distinct `MessageAction`s at their own timestamps.

## Judgment calls worth knowing

**A connection is recorded as a `FollowAction`, and that is not an exact fit.**
A LinkedIn connection is mutual and consented; a follow is neither. What makes
it defensible is that connecting does create a follow in both directions. Only
your side is written — inventing the reciprocal edge would double every
connection to say something the row never said. The ontology has no
"connected with" verb; if one is ever added, this is what should move to it.

**A message body is text, never markup.** A quarter of the messages in an
export arrive as the LinkedIn editor's raw HTML — sponsored InMail and every
templated notice. `htmlToText` from `@chronicle.app/etl` turns each back into
what a reader saw: paragraphs
and `<br>` become line breaks, list items become lines, entities are decoded,
and `&nbsp;` becomes an ordinary space rather than an invisible U+00A0 that
would make the words unfindable by search.

A link keeps **both** its label and its URL, rendered `label (url)`. LinkedIn's
anchors mostly read "here" or "Get started", so the label alone would say
nothing about where it went. A tag is only recognized when its name is followed
by whitespace, `/` or `>`, which is what keeps a bare `<https://example.com>` in
a plain-text message from being deleted as markup — a tag name cannot contain a
colon. A body with no tags is entity-decoded and otherwise left exactly as
typed, because its line breaks are the sender's own.

**Dates keep the precision LinkedIn wrote them at.** A position reads
`2022-08`, an old one `2009`, a connection `2026-06-06`. The store parses each
at its own precision, so widening them to a moment would be a lie.

**Snapshot vs event is decided per file.** `Connections.csv` is a `snapshot`
read even though every row carries a real "Connected On": the date is history,
but their company and title are current, and back-dating those to a connection
made in 2010 would claim they worked there then. `Positions.csv` and
`Education.csv` are snapshots for the same reason. Messages, endorsements,
follows and learning are events.

**Re-importing the same directory is a no-op.** The sighting time is the
export's own file time, not the moment of import, so a second run restates
identical assertions instead of minting fresh ones.

## Not read, and why

- **`Ad_Targeting.csv`** — LinkedIn's inferences _about_ you, not anything you
  did. Interesting, but not history.
- **`Skills.csv`** — a bare list with no dates. The schema has no predicate
  attaching a skill to a person, and the endorsements already mint the skills
  as `DefinedTerm`s with real dates behind them.
- **`Invitations.csv`** — no verb for it, and an accepted invitation is already
  recorded as the connection. It is read for the self-detection above.
- **`Rich_Media.csv`** — profile photo uploads, behind signed `licdn.com` URLs
  that expire.
- **Message attachments** — signed `linkedin.com/dms/…` URLs carrying an expiry
  and a per-export token. The link dies long before the archive is old, and an
  entity keyed on it would mint a fresh identity every export. The bytes are
  not in the ZIP.
- **Free-text locations** (`Geo Location`, a position's `Location`) — a
  name-keyed `Place` would collide with the geocoded places other plugins mint.
- **The message folder** (`INBOX` / `ARCHIVE`) — no home for it that is not a
  stretch.

## Development

```bash
npm run build -w @chronicle.app/linkedin
npm test -w @chronicle.app/linkedin
```

Tests write a small synthetic export to a temporary directory. It reproduces
the awkward parts of a real one: the `Notes:` preamble above
`Connections.csv`'s header, a connection LinkedIn withheld entirely, a group
thread whose name list is longer than its URL list, an HTML message body, and
`N/A` where a date should be. The tests pass the export directory explicitly,
so they never read the host's LinkedIn data or any account.
