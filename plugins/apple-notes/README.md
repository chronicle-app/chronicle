# @chronicle.app/apple-notes

Notes from Apple Notes on a Mac, who made each one, and who wrote what in them, when.

## Usage

```sh
chronicle extract apple-notes
chronicle extract apple-notes -t edits --since 2026-10-01
chronicle extract apple-notes -t edits --session-gap 5
chronicle extract apple-notes --input "/path/to/NoteStore.sqlite"
```

The store is `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`, opened read-only with built-in `node:sqlite`. Reading it needs Full Disk Access. Attachments are found in the `Accounts` folder beside it.

There are two record types, and a bare run extracts both:

- `notes`: each note as it is now, newest made first. `--since` and `--until` bound when each was made.
- `edits`: bursts of one person's writing in one note, newest first. `--since` and `--until` bound when each ended. `--session-gap` sets how many minutes without writing end a burst, 20 by default.

## Schema

| Notes thing        | Chronicle node                                                | Key                                                                                      | Properties                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Making a note      | `CreateAction`                                                | `@type`, `source`, `sourceId` (the note's ID)                                            | `agent` (who made it), `timestamp` (when), `result` (the note)                                                                                                                                                      |
| The note           | `Note`                                                        | `@type`, `source`, `sourceId` (its ID)                                                   | `name` (its title), `body` (its text as Markdown), `tags` (its hashtags), `isPartOf` (its folder), `contains` (its file attachments)                                                                                |
| A folder           | `Collection`                                                  | `@type`, `source`, `sourceId` (its ID)                                                   | `name`                                                                                                                                                                                                              |
| A file attachment  | `ImageObject`, `DocumentObject`, `AudioObject`, `VideoObject` | `@type`, `source`, `sourceId` (its ID)                                                   | `name`, when it has one; `contentPath`, when the file is on this Mac                                                                                                                                                |
| A burst of writing | `UpdateAction`                                                | `@type`, `source`, `object.sourceId`, `agent.sourceId`, `startTime`                      | `agent` (who typed it), `startTime` and `endTime`, `object` (the note), `result` (what it added)                                                                                                                    |
| What a burst added | `Changeset`                                                   | `@type`, `source`, `action.object.sourceId`, `action.agent.sourceId`, `action.startTime` | `body` (the text from the burst that's still in the note), `isPartOf` (the note)                                                                                                                                    |
| You                | `Person`                                                      | `@type`, `source` (`icloud`), `sourceId` (your Apple Account's DSID)                     | `handle` (your Apple Account email); `sameAs` `@me`                                                                                                                                                                 |
| Anyone else        | `Person`                                                      | `@type`, `source`, `sourceId` (their CloudKit user ID in Notes)                          | `name`; `sameAs` every email and number the shares and their Contacts card have, as `Agent`s keyed by `source` (`email` or `phone`) and `handle`, and the card, keyed by `source` (`apple-contacts`) and `sourceId` |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**A note is a `Note`, not a file.** A `MediaObject` such as a `DocumentObject` is a file, with a path and a media type. A note has neither: Notes keeps its text as a CRDT inside the database, and the Markdown in `body` is a rendering of it. The note keeps its ID however often it's edited; `notes` is a snapshot of each note as it is now, and `edits` is how it got there.

**Notes records when text was written, not each edit.** Since 2021 (iOS 15), Notes stamps each stretch of text with the second it was written. Text from before then has no time, and deleted text is kept only as a tombstone with a length and no characters, so neither what was deleted nor when can be recovered. An edit is a burst of writing whose text is still in the note: the stretches one person wrote with no gap longer than `--session-gap` between them. A burst whose text was all deleted later doesn't appear, and one whose earliest text was deleted starts later, which changes its key.

**Who wrote it comes from the note.** Notes records each character's replica, one Notes install on one device, and each note maps every replica that edited it to a CloudKit user ID. The account's own ID is you. So a shared note's text is credited to whoever typed it, and a burst that two people wrote at the same time is two edits. A replica the note doesn't map has no `agent`. The replica itself isn't kept: Notes doesn't record which device or app it is, so it would be a node with nothing but an ID. A note's maker is the creator its CloudKit record names; a note never synced to iCloud was made on this Mac.

**You are your Apple Account.** The iCloud account in Notes is the Mac's Apple Account, so you're the same `Person` the other Apple plugins make, keyed by its DSID and tagged `@me`. With no Apple Account signed in, you're keyed by your CloudKit user ID in Notes instead, still tagged `@me`.

**Anyone else is keyed by their CloudKit user ID in Notes.** CloudKit, the service Notes syncs through, gives each Apple Account a different ID in each app and never shows anyone else's Apple Account. So the ID is the same in every note but matches nothing outside Notes, and a person's emails and phone numbers link them to the same person in other sources: email by address, and messages and calls by number. They come from the shares in the database, which list each person by the address they were invited at, with the name iCloud has for them. A person invited at different addresses in different shares keeps them all, and someone named in any share is named in every note. Each address is looked up in Contacts, as Call History does, and a card it finds adds its other emails and numbers and is linked itself. iCloud writes a phone number with its country code and no plus; numbers are normalized to E.164.

**What a burst added is a `Changeset` of the note.** The burst updated the note, and the changeset is the change it made. It isn't a `Revision`, a version of the whole note, because Notes can't rebuild the note as it was. Its `body` is the text from the burst that's still in the note, in order, with an ellipsis line between pieces that aren't next to each other. It's Markdown, as the note's `body` is: a line keeps its heading, list, or checklist marker when the burst started it, and text added to the end of an earlier line has none. The edit is dated by its burst, but what it says about the note, its title and the text still in it, is as of the extraction, so it doesn't backdate a later title or deletion.

**Files are attachments; tables, drawings, and link previews aren't.** Images, PDFs, scans, audio, and video are the note's `contains`, with the file's path when it's downloaded to this Mac. The others have no file, so they're left out, and the body names them in brackets, such as `[table]`.

**Some notes have less.** A locked note's text is encrypted, so it has no body and no edits. A note marked for deletion is left out; one in Recently Deleted is in that folder.

**The columns are current macOS's.** Core Data numbers column names such as `ZTITLE1`, and an older or newer macOS can number them differently.

## Tests

The tests build a synthetic `NoteStore.sqlite` with `node:sqlite`, with note bodies, replica maps, and CloudKit records and shares encoded by the test helper, and an image file beside it. They never read the host's Notes.
