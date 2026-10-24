---
'@chronicle.app/youtube': minor
'@chronicle.app/etl': minor
---

YouTube's Takeout reader takes the Takeout itself, as a folder, a zip, or one part of a split Takeout, as well as its "YouTube and YouTube Music" folder, and reads a zip in place. Its manifest declares the Takeout's layout, so `chronicle scan <path>` finds one however it's kept, and a Takeout with its history in JSON shows as a layout it can't read yet. `ExportFiles` says when each file was last changed with `modified(path)`, in a zip from its index, so a zipped Takeout has the same as-of time as the unzipped one. `writeZip` dates a fixture's entries with `modified`.
