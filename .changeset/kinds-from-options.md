---
'@chronicle.app/etl': minor
'@chronicle.app/cli': minor
---

An extractor can say which of its kinds a run's options ask for, with a static `kindsFor(config)`. A run that names no kinds reads those, before the plugin's defaults or asking which. When the kinds a run names leave some of them out, the run says so. Apple Health uses it, so `chronicle extract apple-health --series RestingHeartRate` reads `heart` without naming it.
