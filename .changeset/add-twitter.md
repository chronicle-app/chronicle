---
'@chronicle.app/twitter': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the Twitter plugin, bundled with the CLI. It reads a Twitter/X data archive and emits a `PublishAction` for each tweet, a `LikeAction` for each like, and a `MessageAction` for each direct message. The vocabulary adds `Post`, `PublishAction`, `CreateAction`, `LikeAction`, `ReactAction`, `AssessAction`, `Session`, `references`, and `mentions`, and `author` now applies to any `CreativeWork`.
