---
'@chronicle.app/apple-notes': minor
'@chronicle.app/schema': minor
---

Add the Apple Notes plugin, run as `chronicle extract apple-notes`. It extracts each note in Notes on a Mac, and the bursts of writing still in each one, credited to whoever typed them. A note is a `CreateAction` by whoever made it, whose `result` is the `Note`, keyed by its ID, with its text as Markdown, its hashtags as `tags`, its folder as a `Collection`, and its image, PDF, scan, audio, and video attachments under `contains`. Notes stamps each stretch of text with when it was written and each character with the Notes install that typed it, which each note maps to a person's CloudKit user ID. So `edits` gives each burst of one person's writing as an `UpdateAction` of the note, with its start and end, the installs that typed it as `Device`s, and the text from it that's still in the note as a `Quotation`. People are keyed by their CloudKit user ID in Notes, named from the note's shares, and linked by email and phone to the same person in other sources; you are tagged `@me`.

The vocabulary adds `Note`: a text that its author keeps and edits, such as a note in a notes app or a page in a personal wiki, as against a `DocumentObject`, which is a file.
