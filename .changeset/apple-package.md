---
'@chronicle.app/apple': minor
'@chronicle.app/apple-call-history': patch
'@chronicle.app/apple-voice-memos': patch
'@chronicle.app/apple-wallet': patch
'@chronicle.app/arc-timeline': patch
'@chronicle.app/foodnoms': patch
'@chronicle.app/imessage': patch
'@chronicle.app/safari': patch
'@chronicle.app/shazam': patch
'@chronicle.app/timing-app': patch
'@chronicle.app/whatsapp': patch
---

`@chronicle.app/icloud` is now `@chronicle.app/apple`, since it reads Apple data on a Mac beyond iCloud: the Apple Account signed in, AddressBook contacts, and now binary property lists. Its exports are unchanged, and records still name the Apple Account `icloud`, so every identity stays the same. It adds `parseBinaryPlist` and `Uid`, which read a binary property list such as an NSKeyedArchiver archive; the Shazam plugin, which had its own, now uses them. The plugins that used `@chronicle.app/icloud` depend on `@chronicle.app/apple` instead.
