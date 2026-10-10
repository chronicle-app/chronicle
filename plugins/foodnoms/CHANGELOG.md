# @chronicle.app/foodnoms

## 0.4.0

### Patch Changes

- b567d4e: `DateTime` is now the one datatype for a point in time, and `Date` is gone. A `DateTime` is a JavaScript `Date` or an EDTF string at the precision the source knows: a UTC instant (`2024-03-02T14:05:00Z`), a year, month, or day (`1987`, `1987-06`, `1987-06-12`), unspecified digits (`198X`, `XXXX-03-12`), and an uncertain or approximate date (`1987?`, `1950~`). Strings are checked rather than accepted as they are, and `isDateTime` checks one. `@assertedAt` must be an instant, which `isInstant` checks, so an event dated only partly is no longer asserted at that date. FoodNoms timestamps are now instants rather than strings with a space before the time.
- 7e12eb1: Fix `chronicle extract foodnoms` failing with `ERR_OUT_OF_RANGE` when a meal slot's `sortIndex` is outside JavaScript's safe integer range. FoodNoms can store values near Int64.min there; those now come through as decimal strings.
- Updated dependencies [b0982a5]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/icloud@0.4.0

## 0.3.0

### Minor Changes

- 5c96cd7: Add the FoodNoms plugin, bundled with the CLI. It reads meal logs from the FoodNoms database and emits an `EatAction` or `DrankAction` for each food entry. The vocabulary adds `EatAction`, `DrankAction`, and `Meal`.

### Patch Changes

- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- Updated dependencies [ea24fda]
- Updated dependencies [fd58a46]
- Updated dependencies [651d031]
- Updated dependencies [0f72f02]
  - @chronicle.app/etl-sqlite@0.3.0
  - @chronicle.app/icloud@0.3.0
