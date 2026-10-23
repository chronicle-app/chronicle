---
'@chronicle.app/etl': minor
'@chronicle.app/facebook': minor
'@chronicle.app/instagram': minor
'@chronicle.app/linkedin': minor
---

`ArchiveExtractor` opens `--input` with `openExport`, so the Facebook, Instagram, and LinkedIn readers take their export as the zip the service hands over, or unzipped as before, and read it in place. A subclass reads files by their paths in the export. Each declares its export's layout, so `chronicle scan <path>` finds it. `ExportFiles` lists a folder's names with `children(folder)` and gives a reader outside the export a file on disk with `localPath(path)`, a copy out of a zip that lasts until the export is closed, so Instagram's posts and stories keep their media from a zip. `openExport` takes what to call the export in its messages, like `LinkedIn export`.
