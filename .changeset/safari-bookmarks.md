---
'@chronicle.app/safari': minor
---

Safari reads bookmarks, favorites, and the Reading List, as the `bookmarks` record type, from Safari's `Bookmarks.plist`. `chronicle extract safari` reads them with history, merged newest first; `chronicle extract safari bookmarks` reads them alone, and `--bookmarks-file` reads another `Bookmarks.plist`. Each is a `BookmarkAction` whose `object` is the page and whose `target` is the `Collection` it's saved to: Favorites, Bookmarks Menu, Reading List, or a folder of your own, inside the folder that holds it. A Reading List item is dated when it was added, and so is a bookmark Safari saves now; older bookmarks, which Safari didn't date, have no date.
