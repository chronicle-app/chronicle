# @chronicle.app/imessage

## 0.3.0

### Minor Changes

- fd58a46: Read the Apple Account from the system Accounts database when MobileMeAccounts is empty, as it is on newer macOS, so the account owner is keyed by their DSID again. `buildICloudPersonSchema` now returns `null` when no account can be read, instead of a Person keyed only by `['@type', 'source']` that every account-less owner shared; Safari and iMessage leave the owner out in that case. iMessage's SMS owner with no identifier is left out the same way.

### Patch Changes

- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- Updated dependencies [ea24fda]
- Updated dependencies [fd58a46]
- Updated dependencies [651d031]
- Updated dependencies [0f72f02]
  - @chronicle.app/etl-sqlite@0.3.0
  - @chronicle.app/icloud@0.3.0

## 0.2.0

### Patch Changes

- c097762: Declare `@chronicle.app/etl` and `@chronicle.app/schema` as peer dependencies (`>=0.1.0 <1.0.0`) instead of exact dependencies, so plugins and the packages they build on share the host's copy instead of installing their own.
- Updated dependencies [c097762]
  - @chronicle.app/etl-sqlite@0.2.0
  - @chronicle.app/icloud@0.2.0
