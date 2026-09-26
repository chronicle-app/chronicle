# @chronicle.app/safari

Read Safari's `History.db` with `SafariExtractor`, then emit one `ViewAction` per page visit with `SafariTransformer`. `input` defaults to `~/Library/Safari/History.db`; reading it needs Full Disk Access. The connection is read-only via built-in `node:sqlite`.

Records are visits, newest first, with redirect hops left out. `since`/`until` are exclusive visit-time bounds, and `limit: 0` means unlimited.

Each `ViewAction` is keyed by its timestamp. The visited page is an `Entity` keyed by its URL and named after the page title, or the URL when there is none. The agent is the iCloud account owner from `@chronicle.app/icloud`, omitted when no account can be read. An explicit `account` object (or null) describes exported data without a host account lookup.

Tests use a synthetic history database and never read the host's browsing history or iCloud account.
