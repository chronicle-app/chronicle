---
'@chronicle.app/cli': patch
---

`chronicle extract whatsapp` reads the Mac's WhatsApp database again instead of treating it as an iPhone backup. An extractor's default `--input` no longer counts as a path you gave, so it doesn't switch a source to its export strategy; only an `--input` you pass does.
