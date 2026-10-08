---
'@chronicle.app/chrome': minor
'@chronicle.app/etl-sqlite': minor
'@chronicle.app/schema': minor
'@chronicle.app/etl': minor
---

Add the Chrome plugin. It reads browsing history from a Chrome profile's `History` database, including visits synced from other devices, and emits a `ViewAction` for each page visit. The agent is the profile's Google account: its email address, `sameAs` the account by its Gaia id. A visit reached by following a link or submitting a form also becomes a `NavigateAction` from the page it came from to the page it landed on, and that page `references` the link followed. The vocabulary adds `MoveAction` and `NavigateAction`. `@chronicle.app/etl-sqlite` adds `chromeToUnixMsSql` and `unixMsToChromeTimestamp` for Chromium's microseconds since 1601. `renderShapes` shows each further action a record becomes as its own node.
