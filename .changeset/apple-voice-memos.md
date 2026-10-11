---
'@chronicle.app/apple-voice-memos': minor
'@chronicle.app/schema': minor
---

Add the Apple Voice Memos plugin, run as `chronicle extract apple-voice-memos`. It extracts the recordings in the Voice Memos library on a Mac, which syncs through iCloud and so holds memos from every device on the account. Each memo is a `CreateAction` from when recording started to when it ended, and its `result` is the recording, an `AudioObject` keyed by the memo's ID, with its title, duration, and file. Apple's transcript, when the memo has one, is the recording's `transcript`. Memos in Recently Deleted are left out. The vocabulary adds `transcript`, the words spoken in an audio or video recording, written out as text.
