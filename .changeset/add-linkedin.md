---
'@chronicle.app/linkedin': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the LinkedIn plugin, which reads an unpacked LinkedIn data export: messages, connections, endorsements, company follows, positions, education, Learning courses, and the profile. The schema gains the terms it emits, such as `JoinAction`, `LeaveAction`, `Tenure`, `Enrollment`, `FollowAction`, `RespondAction`, `WatchAction`, and `BookmarkAction`, and an action's `timestamp` may now be a civil date.
