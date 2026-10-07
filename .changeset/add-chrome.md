---
'@chronicle.app/chrome': minor
'@chronicle.app/etl-sqlite': minor
---

Add the Chrome plugin. It reads browsing history from a Chrome profile's `History` database, including visits synced from other devices, and emits a `ViewAction` for each page visit, with the profile's Google account as the agent. `@chronicle.app/etl-sqlite` adds `chromeToUnixMsSql` and `unixMsToChromeTimestamp` for Chromium's microseconds since 1601.
