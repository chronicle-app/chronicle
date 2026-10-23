---
'@chronicle.app/cli': minor
'@chronicle.app/etl': minor
'@chronicle.app/apple-health': minor
---

`chronicle scan <path>` looks through a folder or zip for the exports in it, and says for each which source reads it, where it starts, and the command that extracts it. It walks a folder of exports, opens each zip it finds by its index alone, reads a split Takeout's parts as one, and doesn't go into hidden folders, macOS bundles like a photo library, or links. It names the folders and zips at the top that hold no export, and any zip that won't open. Given a file or folder inside an export, like its `export.xml`, it finds that export. `chronicle survey <path>` counts what each export a scan of the path finds holds. A word with a `/`, a leading `~` or `.`, or a `.zip` is a path; any other is a source.

A plugin's manifest says what each export strategy's exports look like from inside, as `layouts` under the strategy: paths from the folder the export starts at, with `*` and `{option}` as in `locations`, and `"supported": false` for a layout the plugin recognizes but can't read. Matching them takes no plugin code, so an export is found before its plugin is installed. `@chronicle.app/etl` adds `findExports`, to find the exports in a folder or zip, and `findExportsIn`, to find them in a list of paths like a package's manifest. `openExport` opens a folder in a zip by a path through it, like `export.zip/apple_health_export`. Apple Health declares its export's layout.
