---
'@chronicle.app/apple-voice-memos': minor
'@chronicle.app/schema': minor
---

Add the Apple Voice Memos plugin, run as `chronicle extract apple-voice-memos`. It extracts the recordings in the Voice Memos library on a Mac, which syncs through iCloud and so holds memos from every device on the account. Each memo is a `RecordAction` dated when recording started, and its `result` is the recording, an `AudioObject` keyed by the memo's ID, with its title, duration, and file. Apple's transcript, when the memo has one, is a `Transcript` made by a `TranscribeAction` with Voice Memos as its `instrument`, dated when Voice Memos saved the file, and it `isBasedOn` the recording. Memos in Recently Deleted are left out.

The vocabulary adds three kinds of `CreateAction`: `RecordAction`, recording sound or video; `PhotographAction`, taking a photograph; and `TranscribeAction`, writing out the words spoken in a recording. A `TranscribeAction`'s `result` is a `Transcript`, a new class for those words written out. A recording can have several transcripts, each made by its own `TranscribeAction`.
