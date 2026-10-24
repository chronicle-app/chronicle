---
'@chronicle.app/etl': patch
'@chronicle.app/cli': minor
---

`chronicle setup full-disk-access` says whether your terminal has Full Disk Access, and if not, walks through turning it on: it offers to open the list in System Settings, and shows the app in Finder to drag into it. When macOS blocks a file, or `chronicle scan` finds sources or folders macOS blocks, the hint says to run it, and names the app that needs access, like Ghostty, iTerm, or Visual Studio Code, when the shell runs in one of the common terminals and editors. `chronicle setup` holds the commands that set up this computer for the sources that need it.
