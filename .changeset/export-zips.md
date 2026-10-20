---
'@chronicle.app/etl': minor
---

Add `openExport`, which opens an export however it was handed over: a folder, a zip, a folder that holds only zips, or one part of a Google Takeout split into numbered zips (`takeout-…-001.zip`, `-002.zip`, …), which brings in its sibling parts as one export. It lists, finds, and streams files by their paths inside the export. Files in a zip are read in place and decompressed as they stream, so a zip of any size is never unpacked to disk. `writeZip` writes a zip for test fixtures.
