# @chronicle.app/chrome

Read Chrome's `History` database with `ChromeExtractor`, then emit one `ViewAction` per page visit with `ChromeTransformer`. `input` defaults to the `History` file of the `profile` setting (`Default` unless set) in Chrome's profile directory on macOS, Linux, or Windows. The connection is read-only via built-in `node:sqlite`. Chrome keeps the database locked while it runs, so the extractor then reads a temporary copy, removed when it finishes.

Records are visits, newest first. Redirect hops, pages loaded in frames, the extra visits Chrome adds to a search engine's keyword URL, `chrome://` and extension pages, and visits imported from other browsers are left out. Visits synced from your other devices are included. `since`/`until` are exclusive visit-time bounds, and `limit: 0` means unlimited.

Each `ViewAction` is keyed by its timestamp, to the millisecond. The visited page is an `Entity` keyed by its URL and named after the page title, or the URL when there is none. Chrome keeps one title per URL, not per visit, so every visit to a page carries its latest title.

The agent is the Google account the profile is signed in to, read from the profile's `Preferences`: a `google-account` Person keyed by its Gaia id, `sameAs` the account's email address, an `email` Agent as other sources key it. It is omitted for a signed-out profile.

The instrument is the Chrome install that recorded the visit, a `SoftwareApplication` keyed by its sync client id. A synced visit names the install it came from. A local visit names this profile's id at the time; Chrome adds a new id when sync is set up again. Profiles that never set up sync have no instrument.

[SHAPES.md](SHAPES.md) shows what each record type becomes; run `npm run shapes` to update it after changing the transformer. Tests use a synthetic history database and `Preferences` file and never read the host's browsing history.
