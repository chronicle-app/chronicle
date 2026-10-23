---
'@chronicle.app/cli': patch
---

`-t all` and `-t defaults` extract the record types they stand for, as `all` after the source does. Before, a run with either read nothing when its extractor emitted only the chosen types.
