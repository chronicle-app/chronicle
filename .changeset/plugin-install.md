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

The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
