---
'@chronicle.app/apple-voice-memos': minor
'@chronicle.app/schema': minor
---

Add the Apple Voice Memos plugin, run as `chronicle extract apple-voice-memos`. It extracts the recordings in the Voice Memos library on a Mac, which syncs through iCloud and so holds memos from every device on the account. Each memo is a `RecordAction` dated when recording started, and its `result` is the recording, an `AudioObject` keyed by the memo's ID, with its title, duration, and file. Apple's transcript, when the memo has one, is the recording's `transcript`. The action's `instrument` is what the audio file says recorded it: the OS release, as the file writes it, and the kind of device, a `ProductModel` keyed by its Wikidata URL, but never which device. Memos in Recently Deleted are left out.

The vocabulary adds two kinds of `CreateAction`, `RecordAction` for recording sound or video and `PhotographAction` for taking a photograph, and `transcript`, the words spoken in an audio or video recording or a podcast episode, written out as text.
