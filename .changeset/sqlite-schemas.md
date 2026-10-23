---
'@chronicle.app/apple-call-history': minor
'@chronicle.app/apple-voice-memos': minor
'@chronicle.app/imessage': minor
---

iMessage, Apple Call History, and Voice Memos declare the tables and columns they read in their app's database, so `chronicle scan ~/Library/Messages` finds a `chat.db`, as does a scan of any folder with a copy of one, and extract refuses a version of the database it can't read.
