# @chronicle.app/arc-timeline

## 0.3.0

### Minor Changes

- d8d36ef: Add the Arc Timeline plugin, bundled with the CLI. It reads Arc Timeline's daily iCloud backup and emits a `VisitAction` for each stay and a `TravelAction` with a `Journey` for each trip. The vocabulary adds `VisitAction`, `TravelAction`, `Journey`, `Place`, `Venue`, the `Location` structured value, and `Number`, with `startTime`, `endTime`, `result`, `location`, `latitude`, `longitude`, `address`, `category`, `travelMode`, `distance`, and `path`.

### Patch Changes

- Updated dependencies [fd58a46]
- Updated dependencies [0f72f02]
  - @chronicle.app/icloud@0.3.0
