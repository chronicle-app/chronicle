---
'@chronicle.app/slack': minor
---

The Slack reader takes a slackdump export as a folder or a zip, and declares its layout, so `chronicle scan <path>` finds it. From a zip, a downloaded attachment's `contentPath` is a copy that lasts the run.
