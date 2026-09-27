---
'@chronicle.app/email': minor
'@chronicle.app/cli': minor
---

Add the email plugin, bundled with the CLI. It reads messages from an mbox file and emits a `MessageAction` for each message, keyed on its Message-ID, or on its sender, date, and subject when it has none.
