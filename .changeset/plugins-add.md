---
'@chronicle.app/cli': minor
---

`chronicle plugins add <path>` runs a plugin from its folder on your machine (or a single file) without installing it. It loads the plugin once, lists the sources it found, and saves the path to your Chronicle config, so edits apply on the next run. A local plugin takes over any source it provides, including an official one, and each run of that source says so. `chronicle plugins remove <name|path>` stops using it, by name even after its folder is gone, and a plugin whose folder is deleted comes off the list on the next run, and `chronicle plugins` shows local plugins with their paths. TypeScript plugins run directly, without a build.
