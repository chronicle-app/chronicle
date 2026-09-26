# @chronicle.app/arc-timeline

Chronicle plugin for the location timeline from [Arc Timeline](https://apps.apple.com/ca/app/arc-timeline-4/id6740688708) (the iOS app, built on LocoKit).

## Installation

```bash
npm install @chronicle.app/arc-timeline
```

## Usage

Point the extractor at the Arc Timeline **daily backup** — the per-day files the
iOS app writes automatically (no manual export step). On macOS these sync to
iCloud Drive under:

```
~/Library/Mobile Documents/iCloud~com~bigpaua~Arc-Timeline-Editor/Documents/Exports
```

`--input` accepts that `Exports` folder, its `Daily` subfolder, or the
`Daily/JSON` directory that actually holds the `YYYY-MM-DD.json.gz` files — the
extractor resolves the right subdirectory.

### Basic extraction

```bash
chronicle extract arc --input /path/to/Exports
```

### With date filtering

```bash
chronicle extract arc \
  --input /path/to/Exports \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

## Configuration

- `--input`: Path to the daily backup (the `Exports`, `Daily`, or `Daily/JSON` directory); defaults to Arc's iCloud Drive `Exports` folder
- `--identity`: Override the person whose timeline this is (e.g. an email); defaults to the macOS iCloud account
- `--since`: Extract items whose start date is on or after this date
- `--until`: Extract items whose start date is on or before this date
- `--limit`: Maximum number of records to extract

## File Format

The daily backup (schema `2.2.0`, written by the Arc Timeline Editor app on
LocoKit) is a flat directory of one gzipped file per day:

```
Daily/JSON/
  YYYY-MM-DD.json.gz   a self-contained day: { items, places, samples, notes, metadata }
```

Each day's file inlines everything for that day, so there are no cross-file
joins within a day. A timeline item is `{ base, trip | visit }`. `base` holds
the fields common to every item (id, start/end dates, `isVisit`, step count,
heart rate, the `previousItemId`/`nextItemId` linked list). Exactly one of:

- `visit` — a stay: `placeId` (joined to that day's `places`), coordinates, street address.
- `trip` — movement: distance, speed, and a `classifiedActivityType` enum code.

The extractor reads the day files newest-first and joins each visit to that
day's `places`. It emits one record per item:

- `recordType: "visit"` for stays
- `recordType: "travel"` for trips

An item that spans midnight appears in both adjacent days' files; it is deduped
on the stable item id, and a trip's GPS samples (which are split at the day
boundary) are merged from each day its span covers.

## Schema

| Source         | Chronicle                                                                            |
| -------------- | ------------------------------------------------------------------------------------ |
| visit item     | `VisitAction` → `object: Venue`, `startTime`/`endTime`                               |
| trip item      | `TravelAction` → `Journey` (`travelMode`, `distance`, `path`), `startTime`/`endTime` |
| `places` entry | `Venue` (name, coordinates, `address`, `category`, `sameAs` to Foursquare/Google)    |

A dictionary-backed place becomes a `Venue`; a visit Arc never matched to a
place falls back to a coordinate-keyed `Place`. A venue's street address,
locality, and country are folded into the freeform `address` (the geocoder
resolves structured admin areas later); `category` comes from the place's
Google primary type. A trip's GPS `samples` become the `Journey.path` track,
and its `classifiedActivityType` enum is mapped to a `travelMode` name.

### Not yet ingested

The `notes` text is not read yet. The storage shape for free-text day notes is
still being decided.

## Development

```bash
npm install
npm run build
```

Tests use synthetic daily backup files and an explicit `identity`, so they never
read the host's Arc backup or iCloud account.
