# @chronicle.app/chrome

## 0.4.0

### Minor Changes

- b0982a5: Add the Chrome plugin. It reads browsing history from a Chrome profile's `History` database, including visits synced from other devices, and emits a `ViewAction` for each page visit. The agent is the profile's Google account, by its email address, as Gmail and Google Calendar know you. A visit reached by following a link or submitting a form also becomes a `NavigateAction` from the page it came from to the page it landed on, and that page `references` the link followed. The vocabulary adds `MoveAction` and `NavigateAction`. `@chronicle.app/etl-sqlite` adds `chromeToUnixMsSql` and `unixMsToChromeTimestamp` for Chromium's microseconds since 1601. `renderShapes` shows each further action a record becomes as its own node.

### Patch Changes

- Updated dependencies [b0982a5]
- Updated dependencies [ee0525c]
- Updated dependencies [3b3a921]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/google@0.4.0
