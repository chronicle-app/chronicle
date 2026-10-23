---
'@chronicle.app/imessage': minor
---

iMessage declares the tables and columns it reads in a `chat.db`, so `chronicle scan ~/Library/Messages` finds it, as does a scan of any folder with a copy of one, and extract refuses a version of the database it can't read.
