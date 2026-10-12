---
'@chronicle.app/schema': minor
'@chronicle.app/timing-app': minor
'@chronicle.app/claude-code': minor
---

**Breaking:** an action's `instrument` is now a list, and a single value no longer validates. A plugin built against an earlier release that gives one instrument, such as Timing or Claude Code before this release, fails validation until it gives a list. An action can now name several things it used, each as precisely as its source knows: the software that ran, the kind of device it ran on, and the particular device once a source tells which one. The vocabulary adds `ProductModel`, a kind of product such as the iPhone line, for a source that knows only the kind of device. Timing's `ExecuteAction` and Claude Code's `MessageAction` give their instrument as a list of one, and Claude Code's model is an `AIModel` rather than a `SoftwareApplication`.
