# @chronicle.app/things-todo

## 0.3.0

### Patch Changes

- 3f21b60: Name the task owner after the OS account's full name (`id -F` on macOS) when `agentName` isn't configured. The CLI never set `agentName`, so the owner Agent had no name. `agentName` still overrides the resolved name, and the owner's key is unchanged.
- Updated dependencies [ea24fda]
  - @chronicle.app/etl-sqlite@0.3.0

## 0.2.0

### Patch Changes

- c097762: Declare `@chronicle.app/etl` and `@chronicle.app/schema` as peer dependencies (`>=0.1.0 <1.0.0`) instead of exact dependencies, so plugins and the packages they build on share the host's copy instead of installing their own.
- Updated dependencies [c097762]
  - @chronicle.app/etl-sqlite@0.2.0
