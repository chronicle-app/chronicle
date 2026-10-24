---
'@chronicle.app/cli': minor
'@chronicle.app/apple-call-history': minor
'@chronicle.app/apple-podcasts': minor
'@chronicle.app/apple-voice-memos': minor
'@chronicle.app/apple-wallet': minor
'@chronicle.app/imessage': minor
'@chronicle.app/shazam': minor
'@chronicle.app/things-todo': minor
'@chronicle.app/whatsapp': minor
---

iMessage, Apple Call History, Voice Memos, Apple Wallet, Shazam, Things, Apple Podcasts, and WhatsApp declare the tables and columns they read in their app's database, so `chronicle scan ~/Library/Messages` finds a `chat.db`, as does a scan of any folder with a copy of one, and extract refuses a version of the database it can't read. A scan of a folder calls what it finds by its schema a database, as in "Found 2 exports and 1 database", and when it finds only databases where their apps keep them, doesn't list the rest of the folder, the app's own, as unrecognized.
