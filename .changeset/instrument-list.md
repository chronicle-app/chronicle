---
'@chronicle.app/schema': minor
'@chronicle.app/timing-app': minor
'@chronicle.app/claude-code': minor
---

An action's `instrument` is now a list, so an action can name several things it used, each as precisely as its source knows: the software that ran, the kind of device it ran on, and the particular device once a source tells which one. The vocabulary adds `ProductModel`, a kind of product such as the iPhone line, for a source that knows only the kind of device. Timing's `ExecuteAction` and Claude Code's `MessageAction` give their instrument as a list of one.
