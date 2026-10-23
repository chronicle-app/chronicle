---
'@chronicle.app/safari': minor
---

Safari reads bookmarks, favorites, and the Reading List, as the `bookmarks` record type, from Safari's `Bookmarks.plist`. `chronicle extract safari` reads them with history, merged newest first; `chronicle extract safari bookmarks` reads them alone, and `--bookmarks-file` reads another `Bookmarks.plist`. Each is a `BookmarkAction` whose `object` is the page and whose `target` is the `Collection` it's saved to: Favorites, Bookmarks Menu, Reading List, or a folder of your own, inside the folder that holds it. A Reading List item is dated when it was added, and a bookmark when Safari recorded it was added, or else when iCloud made its record. Bookmarks that came over from iCloud's older sync, or that iCloud uploaded together, have no date, as iCloud made them then and not when they were saved.
