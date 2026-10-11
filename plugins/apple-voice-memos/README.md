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

| Voice Memos thing       | Chronicle node        | Key                                                                      | Properties                                                                                                                                                   |
| ----------------------- | --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recording a memo        | `RecordAction`        | `@type`, `source`, `sourceId` (the recording's UUID)                     | `agent` (you), `result` (the recording), `timestamp` (when recording started)                                                                                |
| The recording           | `AudioObject`         | `@type`, `source` (`apple-voice-memos`), `sourceId` (its UUID)           | `name` (its title), `duration`, `contentPath` and `mimeType` (its audio file, when it's on this Mac: `audio/mp4` for `.m4a`, `audio/x-quicktime` for `.qta`) |
| Transcribing it         | `TranscribeAction`    | `@type`, `source`, `sourceId` (the recording's UUID)                     | `agent` (you), `instrument` (Voice Memos), `result` (the transcript), `timestamp` (when Voice Memos saved the file)                                          |
| Voice Memos' transcript | `Transcript`          | `@type`, `source`, `sourceId` (the recording's UUID)                     | `body` (its text), `isBasedOn` (the recording)                                                                                                               |
| Voice Memos, the app    | `SoftwareApplication` | `@type`, `source` (`apple-bundle-id`), `handle` (`com.apple.VoiceMemos`) | `name`                                                                                                                                                       |
| You                     | `Person`              | `@type`, `source` (`icloud`), `sourceId` (your account's DSID)           | `handle` (your Apple Account email); `sameAs` `@me`                                                                                                          |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**Recording a memo is a `RecordAction`.** Its `result` is the recording, keyed by the recording's UUID. Voice Memos writes the same UUID into the audio file, so the recording keeps its key wherever its file is read from. The action's `timestamp` is when recording started, which the audio file's own `date` tag agrees with.

**No `endTime`.** Voice Memos keeps the recording's duration but not when recording stopped. A memo can be paused, resumed later, or trimmed, so the start plus the duration isn't always when recording stopped, and the action has none. The recording's `duration` is its length.

**The recording's file, when it's on this Mac.** A recording's `contentPath` is its audio file, captured at ingest. iCloud can keep a recording's audio in the cloud alone, leaving no file or an empty one; that recording has no `contentPath`. Older recordings are `.m4a` files, and newer ones `.qta`, QuickTime audio, which macOS declares as `audio/x-quicktime`.

**Deleted memos are left out.** A memo in Recently Deleted has an eviction date in the library, and isn't extracted.

**No device.** The audio file's encoder tag names the kind of device that recorded it, such as an iPhone or an Apple Watch, but never which one, so the `RecordAction` has no `instrument`.

**A transcript is its own work.** Voice Memos transcribes recordings itself, from iOS 18 on. Its transcript is a `Transcript` whose `body` is the text, plain with no timings, and which `isBasedOn` the recording. A `TranscribeAction` makes it, with Voice Memos as the `instrument`, named by its bundle ID as Timing names apps. The transcript isn't a property of the recording, so a recording can have several: another made later, such as by a different speech recognizer, is the `result` of its own `TranscribeAction` and stands beside this one rather than replacing it. A recording Voice Memos heard no speech in has an empty transcript, which is left out. The extracted record keeps when each word was spoken and the transcript's locale, which have no Chronicle terms yet.

**The transcript is dated when the file was saved.** Voice Memos doesn't keep when it transcribed a recording. It saves the transcript into the audio file, though, and the file's movie header (`mvhd`) holds when the file was last saved, which is the `TranscribeAction`'s `timestamp`. For a recording transcribed while it was made, that's when recording stopped. For one transcribed later, it's when that happened, or a later edit to the file. A transcript in a file whose header has no save time is left out.

**The agent is your iCloud account,** whose library this is, from `@chronicle.app/icloud`. It's omitted when no account can be read. An explicit `account` object (or null) describes a copied library without a host account lookup.

**The files are read in the plugin.** A transcript is JSON inside the audio file: a `.m4a` keeps it in its audio track's `tsrp` box, and a `.qta` in its track's QuickTime metadata under `com.apple.VoiceMemos.tsrp`. `mp4.ts` reads only the movie header, not the audio: the transcript, the encoder tag, and the modification time. The transcript lists its text in runs, each with when it was spoken; the extracted record keeps the runs and the locale. A file or transcript that doesn't read is logged and left out; the recording is kept.

## Tests

The tests are smoke tests over a synthetic `CloudRecordings.db` and synthetic `.m4a` and `.qta` files with no real audio, written by the fixture, and pass an explicit iCloud account. They never read the host's Voice Memos library or iCloud account.
