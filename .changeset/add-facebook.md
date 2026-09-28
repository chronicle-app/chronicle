---
'@chronicle.app/facebook': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the Facebook plugin, bundled with the CLI. It reads a Facebook data export and emits a `MessageAction` for each Messenger message, a `FindAction` with a `Query` for each search, a `LikeAction` for each like, and a `RespondAction` for each reaction or comment. The vocabulary adds `FindAction`, `Query`, `AssessAction`, `ReactAction`, `LikeAction`, `RespondAction`, `Post`, `Response`, and `Comment`, and `author` now applies to any `CreativeWork`.
