---
'@chronicle.app/etl': minor
'@chronicle.app/schema': patch
---

A `body` or `description` is plain text or Markdown, never HTML. `tidyText` cleans text a source wrote for a screen: it removes padding characters and takes tracking parameters off links, and with `dropLongUrls` (for bulk mail) drops click-tracking redirect URLs while keeping the link's words. `sampleTransform` fails a plugin's SHAPES test when a `body` or `description` holds HTML; a plugin whose text is code passes `allowMarkup`.
