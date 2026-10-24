---
'@chronicle.app/safari': minor
---

Safari reads bookmarks, favorites, and the Reading List, as the `bookmarks` record type, from Safari's `Bookmarks.plist`. `chronicle extract safari` reads them with history, merged newest first; `chronicle extract safari bookmarks` reads them alone. With `--input`, they're read from the `Bookmarks.plist` beside that `History.db`, if there is one, and `--bookmarks-file` reads another. Each is a `BookmarkAction` whose `object` is the page and whose `target` is the `Collection` it's saved to: Favorites, Bookmarks Menu, Reading List, or a folder of your own, inside the folder that holds it. Each is dated by when it was added. Safari records that for every Reading List item, but only for bookmarks it saved recently, so older bookmarks are left out.
