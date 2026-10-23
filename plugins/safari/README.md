# @chronicle.app/safari

Read Safari's `History.db` with `SafariExtractor`, then emit one `ViewAction` per page visit with `SafariTransformer`. `input` defaults to `~/Library/Safari/History.db`; reading it needs Full Disk Access. The connection is read-only via built-in `node:sqlite`.

Records are visits, newest first, with redirect hops left out. `since`/`until` are exclusive visit-time bounds, and `limit: 0` means unlimited.

Each `ViewAction` is keyed by its timestamp. The visited page is an `Entity` keyed by its URL and named after the page title, or the URL when there is none. The agent is the iCloud account owner from `@chronicle.app/apple`, omitted when no account can be read. An explicit `account` object (or null) describes exported data without a host account lookup.

## Bookmarks

`SafariBookmarksExtractor` reads the `bookmarks` record type from Safari's `Bookmarks.plist`, at `bookmarksFile` (`~/Library/Safari/Bookmarks.plist` by default), which also needs Full Disk Access. Each bookmark, favorite, and Reading List item becomes a `BookmarkAction` whose `object` is the page and whose `target` is the folder it's in now, a `Collection`: Favorites, Bookmarks Menu, Reading List, or a folder of your own, which `isPartOf` the folder it's in. A bookmark outside any folder has no target. The file holds only what's saved now, so a run is a snapshot, asserted when the file last changed.

A bookmark is keyed by its iCloud record name, which is the same on each device, or by its ID on this Mac when it doesn't sync. It's dated by when it was saved:

- A Reading List item by when it was added.
- A bookmark by when it was added, which Safari records for bookmarks it saves now.
- Otherwise, when iCloud made its record. A record from iCloud's older bookmark sync (named `DAV-`) was made when Safari moved to the newer one, and records made in the same second were uploaded together, as on a new Mac, so these give no date. Nor does a bookmark that doesn't sync with iCloud.

A bookmark with no date has no `timestamp`. Records are newest first, then those with no date. `since`/`until` are exclusive bounds on the date, and leave out those with none.

Tests use a synthetic history database and bookmarks file and never read the host's browsing history, bookmarks, or iCloud account.
