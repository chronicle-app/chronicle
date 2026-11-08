---
'@chronicle.app/fitbit': minor
'@chronicle.app/schema': minor
---

A new legacy plugin, `@chronicle.app/fitbit`, extracts your exercises, sleep, heart rate, steps, and weight from the account archive Fitbit's Data Export page made, which Fitbit no longer makes. Sleep and weight times, which the archive writes without an offset, take each day's offset from its heart rate readings, so a night away is in the zone it was spent in.

The vocabulary adds `ExerciseAction`, the agent exercising from its start to its end, whose result is an `ExerciseSession` with the kind of exercise as its `category`. `distance` is on an `ExerciseSession` as well as a `Journey`.
