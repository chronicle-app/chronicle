# @chronicle.app/arc-timeline

## 0.4.0

### Patch Changes

- Updated dependencies [2148753]
  - @chronicle.app/icloud@0.4.0

## 0.3.0

### Minor Changes

- d8d36ef: Add the Arc Timeline plugin, bundled with the CLI. It reads Arc Timeline's daily iCloud backup and emits a `VisitAction` for each stay and a `TravelAction` with a `Journey` for each trip. The vocabulary adds `VisitAction`, `TravelAction`, `Journey`, `Place`, `Venue`, the `Location` structured value, and `Number`, with `startTime`, `endTime`, `result`, `location`, `latitude`, `longitude`, `address`, `category`, `travelMode`, `distance`, and `path`.

### Patch Changes

- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- b6a5660: Arc Timeline runs as `chronicle extract arc-timeline` instead of `arc`; its records keep the `arc` namespace. The Call History plugin is now `@chronicle.app/apple-call-history`, run as `chronicle extract apple-call-history` instead of `apple-phone`, and its records (and Timing's relayed calls, which fold with them) use the `apple-call-history` namespace, named for Apple's CallHistory store (`com.apple.CallHistory`), which holds phone and FaceTime calls alike. The `sources` table names the plugin where it matters: the one to install when its name differs from the source's, which local plugin is running a source, and which package outside the catalog provides one.
- Updated dependencies [fd58a46]
- Updated dependencies [0f72f02]
  - @chronicle.app/icloud@0.3.0
