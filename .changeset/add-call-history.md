---
'@chronicle.app/call-history': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the Call History plugin, bundled with the CLI. It reads phone and FaceTime calls from the macOS Call History database and emits a `CallAction` whose result is a `CallSession` for each call. The vocabulary adds `InteractAction`, `CommunicateAction`, `CallAction`, `Session`, `CallSession`, and `notes`, and `recipient` applies to `CallSession`.
