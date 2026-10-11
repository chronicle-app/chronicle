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

| Voice Memos thing | Chronicle node | Key                                                            | Properties                                                                                                                                                                            |
| ----------------- | -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recording a memo  | `CreateAction` | `@type`, `source`, `sourceId` (the recording's UUID)           | `agent` (you), `result` (the recording), `startTime` (when recording started), `endTime` (when it stopped)                                                                            |
| The recording     | `AudioObject`  | `@type`, `source` (`apple-voice-memos`), `sourceId` (its UUID) | `name` (its title), `duration`, `contentPath` and `mimeType` (its audio file, when it's on this Mac: `audio/mp4` for `.m4a`, `audio/x-quicktime` for `.qta`), `transcript` (its text) |
| You               | `Person`       | `@type`, `source` (`icloud`), `sourceId` (your account's DSID) | `handle` (your Apple Account email); `sameAs` `@me`                                                                                                                                   |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**Recording a memo is creating it.** A memo is a `CreateAction` whose `result` is the recording, keyed by the recording's UUID. Voice Memos writes the same UUID into the audio file, so the recording keeps its key wherever its file is read from. The action runs from when recording started to its duration later.

**The recording's file, when it's on this Mac.** A recording's `contentPath` is its audio file, captured at ingest. iCloud can keep a recording's audio in the cloud alone, leaving no file or an empty one; that recording has no `contentPath`. Older recordings are `.m4a` files, and newer ones `.qta`, QuickTime audio, which macOS declares as `audio/x-quicktime`.

**Deleted memos are left out.** A memo in Recently Deleted has an eviction date in the library, and isn't extracted.

**No device.** The audio file's encoder tag names the kind of device that recorded it, such as an iPhone or an Apple Watch, but never which one, so the action has no `instrument`.

**The words spoken are the recording's `transcript`.** Voice Memos transcribes recordings itself, from iOS 18 on. The text is the recording's `transcript`, plain text with no timings, not its `body`, since it's a machine's reading of what was said rather than text anyone wrote. A recording Voice Memos heard no speech in has an empty transcript, which is left out. The extracted record keeps when each word was spoken and the transcript's locale, which have no Chronicle terms yet.

**The agent is your iCloud account,** whose library this is, from `@chronicle.app/icloud`. It's omitted when no account can be read. An explicit `account` object (or null) describes a copied library without a host account lookup.

**The files are read in the plugin.** A transcript is JSON inside the audio file: a `.m4a` keeps it in its audio track's `tsrp` box, and a `.qta` in its track's QuickTime metadata under `com.apple.VoiceMemos.tsrp`. `mp4.ts` reads only the movie header, not the audio. The transcript lists its text in runs, each with when it was spoken; the extracted record keeps the runs and the locale. A file or transcript that doesn't read is logged and left out; the recording is kept.

## Tests

The tests are smoke tests over a synthetic `CloudRecordings.db` and synthetic `.m4a` and `.qta` files with no real audio, written by the fixture, and pass an explicit iCloud account. They never read the host's Voice Memos library or iCloud account.
