---
'@chronicle.app/timing-app': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the Timing plugin, bundled with the CLI. It reads app usage, logged time entries, and relayed phone calls from Timing's local database and emits `ExecuteAction`, `ExperienceAction`, and `CallAction` records. The vocabulary adds `DeviceSession`, `PhysicalObject`, `Device`, `Directory`, `workingDirectory`, `subject`, and `model`.
