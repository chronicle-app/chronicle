---
'@chronicle.app/whatsapp': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the WhatsApp plugin, bundled with the CLI. It reads messages from the macOS WhatsApp database, or from an unencrypted iPhone backup with `--via backup`, and emits a `MessageAction` for each message. The vocabulary adds `CreativeWork`, `Channel`, `member`, and `inReplyTo`.
