---
'@chronicle.app/cli': minor
---

`--transformer <name>` reshapes each record with a plugin's transformer, after the source's own, such as into another system's format. A plugin's transformer extends `Transformer` and sets `static source`, its name, and `static inputSchema = 'chronicle'`. `chronicle plugins add` takes a plugin that has only a transformer, and says how to run it. An unknown name, or `--raw` with `--transformer`, is a usage error.
