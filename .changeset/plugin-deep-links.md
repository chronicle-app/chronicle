---
'@chronicle.app/zotero': patch
'@chronicle.app/obsidian': patch
'@chronicle.app/cli': patch
---

The Zotero and Obsidian plugins declare `chronicle.deepLinks` in their package.json again, so hosts that serve stored records can link them into the app. Zotero works, annotations, and notes open with `zotero://select/…`, and attachments with `zotero://open-pdf/…`. Obsidian notes open with `obsidian://open?vault=…&file=…`. The CLI README documents the `deepLinks` block, and `chronicle plugins new` mentions it in the plugin's `AGENTS.md`.
