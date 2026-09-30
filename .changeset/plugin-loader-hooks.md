---
'@chronicle.app/cli': patch
---

Stop printing `[DEP0205] DeprecationWarning: module.register() is deprecated` on Node 26. The CLI now shares its packages with plugins through `module.registerHooks()` where Node has it (22.15+), falling back to `module.register()` on older Node 22. `@chronicle.app/logging` is now shared with plugins too, so a plugin that imports it directly follows the CLI's output.
