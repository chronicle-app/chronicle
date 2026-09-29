---
'@chronicle.app/cli': patch
---

`chronicle plugins` labels the core plugins `bundled` when the CLI runs through npx or a flat install, where npm puts them beside the CLI, instead of `beside-cli`. A separately installed copy beside the CLI is still labelled `beside-cli` and still takes precedence.
