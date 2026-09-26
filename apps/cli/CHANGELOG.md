# @chronicle.app/cli

## 0.3.0

### Minor Changes

- d8d36ef: Add the Arc Timeline plugin, bundled with the CLI. It reads Arc Timeline's daily iCloud backup and emits a `VisitAction` for each stay and a `TravelAction` with a `Journey` for each trip. The vocabulary adds `VisitAction`, `TravelAction`, `Journey`, `Place`, `Venue`, the `Location` structured value, and `Number`, with `startTime`, `endTime`, `result`, `location`, `latitude`, `longitude`, `address`, `category`, `travelMode`, `distance`, and `path`.
- 350ec02: Add the Safari plugin, bundled with the CLI. It reads browsing history from Safari's `History.db` and emits a `ViewAction` for each page visit. The vocabulary adds `ViewAction`.

### Patch Changes

- Updated dependencies [d8d36ef]
- Updated dependencies [350ec02]
- Updated dependencies [350ec02]
- Updated dependencies [fd58a46]
- Updated dependencies [3f21b60]
- Updated dependencies [0f72f02]
  - @chronicle.app/arc-timeline@0.3.0
  - @chronicle.app/schema@0.3.0
  - @chronicle.app/safari@0.3.0
  - @chronicle.app/etl@0.3.0
  - @chronicle.app/imessage@0.3.0
  - @chronicle.app/things-todo@0.3.0
  - @chronicle.app/claude-code@0.3.0
  - @chronicle.app/shell@0.3.0
  - @chronicle.app/auth@0.3.0

## 0.2.0

### Patch Changes

- d71b202: Upgrade `csv-parse` to 7, which fixes a prototype-replacement advisory in the `columns` option (GHSA-8cw4-87c7-c6xx), and the CLI's `glob` to 13, replacing a deprecated release.
- Updated dependencies [d71b202]
- Updated dependencies [c097762]
- Updated dependencies [63bbde7]
  - @chronicle.app/etl@0.2.0
  - @chronicle.app/claude-code@0.2.0
  - @chronicle.app/imessage@0.2.0
  - @chronicle.app/shell@0.2.0
  - @chronicle.app/things-todo@0.2.0
  - @chronicle.app/schema@0.2.0
  - @chronicle.app/auth@0.2.0
