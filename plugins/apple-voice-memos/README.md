# @chronicle.app/apple-voice-memos

Your Voice Memos recordings and the transcripts Voice Memos made of them, from the library macOS keeps in step with iCloud.

## Usage

```sh
chronicle extract apple-voice-memos
chronicle extract apple-voice-memos --since 2024-01-01 --until 2025-01-01
chronicle extract apple-voice-memos --input "/path/to/Recordings/CloudRecordings.db"
```

The library is `~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/CloudRecordings.db`, opened read-only with built-in `node:sqlite`, and the audio files sit beside it. Voice Memos syncs the library through iCloud, so it holds the recordings made on every device signed in to your account: your iPhone, iPad, Apple Watch, and Mac. With `--input`, the audio files are read from the folder the database is in.

Recordings come out newest first, and `--since` and `--until` bound when each one started. A run reads only the library and its files, offline.

## Schema

| Voice Memos thing             | Chronicle node    | Key                                                                                                                 | Properties                                                                                                                                                                            |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recording a memo              | `RecordAction`    | `@type`, `source`, `sourceId` (the recording's UUID)                                                                | `agent` (you), `instrument` (the OS release and the kind of device), `result` (the recording), `timestamp` (when recording started)                                                   |
| The OS release the file names | `OperatingSystem` | `@type`, `source` (`apple-voice-memos`), `handle` (the tag as written, such as `Watch Version 11.5 (Build 22T572)`) |                                                                                                                                                                                       |
| The kind of device            | `ProductModel`    | `source` (`wikidata`), `sourceId` (its Wikidata ID, such as `Q2766`)                                                | `name` (`iPhone`, `Apple Watch`, or `Mac`)                                                                                                                                            |
| The recording                 | `AudioObject`     | `@type`, `source` (`apple-voice-memos`), `sourceId` (its UUID)                                                      | `name` (its title), `duration`, `contentPath` and `mimeType` (its audio file, when it's on this Mac: `audio/mp4` for `.m4a`, `audio/x-quicktime` for `.qta`), `transcript` (its text) |
| You                           | `Person`          | `@type`, `source` (`icloud`), `sourceId` (your account's DSID)                                                      | `handle` (your Apple Account email); `sameAs` `@me`                                                                                                                                   |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**Recording a memo is a `RecordAction`.** Its `result` is the recording, keyed by the recording's UUID. Voice Memos writes the same UUID into the audio file, so the recording keeps its key wherever its file is read from. The action's `timestamp` is when recording started, which the audio file's own `date` tag agrees with.

**No `endTime`.** Voice Memos keeps the recording's duration but not when recording stopped. A memo can be paused, resumed later, or trimmed, so the start plus the duration isn't always when recording stopped, and the action has none. The recording's `duration` is its length.

**A file or transcript that doesn't read is reported.** The memo is kept, and the run's summary says how many didn't read, since that's how a format Voice Memos changed would show.

**Each record is read as of the library's last change.** A title or transcript can change long after the recording is made, so a record's observation time is when the library, or its write-ahead log, last changed, not when recording started. An unchanged library gives the same records on every run.

**The recording's file, when it's on this Mac.** A recording's `contentPath` is its audio file, captured at ingest. iCloud can keep a recording's audio in the cloud alone, leaving no file or an empty one; that recording has no `contentPath`. Older recordings are `.m4a` files, and newer ones `.qta`, QuickTime audio, which macOS declares as `audio/x-quicktime`.

**Deleted memos are left out.** A memo in Recently Deleted has an eviction date in the library, and isn't extracted.

**The instrument is what the file says, not which device.** The audio file's encoder tag, such as `com.apple.VoiceMemos (Watch Version 11.5 (Build 22T572))`, names the kind of device and the OS release that wrote the file, but never which device: no device name, model, or serial. The action's `instrument` is that release, an `OperatingSystem` whose `handle` is the tag as written, without the app's name, which the source already implies. Beside it is the kind of device, a `ProductModel` keyed by its Wikidata ID, so other sources can name the same one: [iPhone](https://www.wikidata.org/wiki/Q2766), [Apple Watch](https://www.wikidata.org/wiki/Q18010946), or [Mac](https://www.wikidata.org/wiki/Q75687) for an older `Mac OS X` tag. A device identified only by its kind would merge every iPhone you've owned into one, so there is no `Device`. Another source that knows which device it was can add it to the action's instruments.

- A tag that doesn't name the kind of device gives only the release. `iOS 13.1.2` could be an iPhone or an iPad, and `iPad Version …` could be a Mac: Voice Memos on a Mac is the iPad app, so a Mac's tag says `iPad`, with macOS's version and build.
- A tag that doesn't name an OS release, such as `aphone5 (null)`, which appears on memos from 2020 to 2022, gives no instrument.
- The tag is from whichever device last wrote the file. iOS 13 rewrote older recordings with its own tag, in the older `iOS 13.1.2` form. A tag in an older form (`iOS …` or `Mac OS X …`) naming a release that came out after the recording was made is from that rewrite, and gives no instrument. Voice Memos stopped writing those forms in 2020, so the plugin's list of their release dates is complete. A tag in the current form (`iPhone Version …`) is taken as written, with no dates to keep up.
- Editing a memo on another device, such as trimming it on a Mac, rewrites the tag with that device's release, and nothing in the file tells. The memo is then credited to the device that edited it.
- The extracted record keeps the whole tag.

**The words spoken are the recording's `transcript`.** Voice Memos transcribes recordings itself, from iOS 18 on. The text is the recording's `transcript`, plain text with no timings, not its `body`, since it's a machine's reading of what was said rather than text anyone wrote. It's Voice Memos' own transcript: when Voice Memos makes a new one, such as after a trim, it takes the old one's place. A transcript from another speech recognizer belongs to that source's own record of the recording, so it never replaces Apple's. A recording Voice Memos heard no speech in has an empty transcript, or only spaces, which is left out. The extracted record keeps when each word was spoken and the transcript's locale, which have no Chronicle terms yet.

**The agent is your iCloud account,** whose library this is, from `@chronicle.app/icloud`. It's omitted when no account can be read. An explicit `account` object (or null) describes a copied library without a host account lookup.

**The files are read in the plugin.** A transcript is JSON inside the audio file: a `.m4a` keeps it in its audio track's `tsrp` box, and a `.qta` in its track's QuickTime metadata under `com.apple.VoiceMemos.tsrp`. `mp4.ts` reads only the movie header, not the audio. The transcript lists its text in runs, each with when it was spoken; the extracted record keeps the runs and the locale. A file or transcript that doesn't read is logged and left out; the recording is kept.

## Tests

The tests are smoke tests over a synthetic `CloudRecordings.db` and synthetic `.m4a` and `.qta` files with no real audio, written by the fixture, and pass an explicit iCloud account. They never read the host's Voice Memos library or iCloud account.
