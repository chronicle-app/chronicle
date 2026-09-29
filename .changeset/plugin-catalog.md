---
'@chronicle.app/cli': minor
'@chronicle.app/arc-timeline': patch
'@chronicle.app/arena': patch
'@chronicle.app/bluesky': patch
'@chronicle.app/call-history': patch
'@chronicle.app/claude-code': patch
'@chronicle.app/email': patch
'@chronicle.app/facebook': patch
'@chronicle.app/foodnoms': patch
'@chronicle.app/foursquare': patch
'@chronicle.app/goodreads': patch
'@chronicle.app/google-reader': patch
'@chronicle.app/imessage': patch
'@chronicle.app/instagram': patch
'@chronicle.app/lastfm': patch
'@chronicle.app/linkedin': patch
'@chronicle.app/marvin': patch
'@chronicle.app/moves-app': patch
'@chronicle.app/obsidian': patch
'@chronicle.app/pinboard': patch
'@chronicle.app/safari': patch
'@chronicle.app/shell': patch
'@chronicle.app/slack': patch
'@chronicle.app/spotify': patch
'@chronicle.app/things-todo': patch
'@chronicle.app/timing-app': patch
'@chronicle.app/twitter': patch
'@chronicle.app/whatsapp': patch
'@chronicle.app/youtube': patch
'@chronicle.app/zotero': patch
---

`chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
