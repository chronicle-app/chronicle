---
'@chronicle.app/cli': patch
'@chronicle.app/facebook': patch
'@chronicle.app/instagram': patch
---

`chronicle sources` fits its table to the terminal: narrow columns size to their content and never wrap, and Record Types and Description share the rest of the width, truncating only when they have to. `--format json` includes each extractor's `default`. Facebook defaults to Messenger conversations and Instagram to posts, so `chronicle extract facebook` and `chronicle extract instagram` work without `--type`.
