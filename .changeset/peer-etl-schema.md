---
'@chronicle.app/etl-sqlite': patch
'@chronicle.app/icloud': patch
'@chronicle.app/claude-code': patch
'@chronicle.app/imessage': patch
'@chronicle.app/shell': patch
'@chronicle.app/things-todo': patch
---

Declare `@chronicle.app/etl` and `@chronicle.app/schema` as peer dependencies (`>=0.1.0 <1.0.0`) instead of exact dependencies, so plugins and the packages they build on share the host's copy instead of installing their own.
