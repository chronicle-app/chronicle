# @chronicle.app/moves-app

Chronicle plugin for the location storyline from [Moves](<https://en.wikipedia.org/wiki/Moves_(application)>) — the automatic activity tracker ProtoGeo built, Facebook bought in 2014, and shut down in July 2018.

## Installation

```bash
npm install @chronicle.app/moves-app
```

## Usage

Point the extractor at your unzipped Moves export — the archive the
moves-export.com service handed you before the shutdown, which is the only way
this data ever left the app.

### Basic extraction

```bash
chronicle extract moves-app --input /path/to/moves_export
```

### With date filtering

```bash
chronicle extract moves-app \
  --input /path/to/moves_export \
  --since 2015-01-01 \
  --until 2015-12-31 \
  --limit 1000
```

## Configuration

- `--input` (required): Path to the unzipped export
- `--since`: Extract records that start on or after this date
- `--until`: Extract records that start on or before this date
- `--limit`: Maximum number of records to extract (the most recent ones)

## File Format

The export holds the same history at five roll-ups (daily, weekly, monthly,
yearly, full) and in four cuts (storyline, places, activities, summary), in
several formats. This plugin reads the JSON **storyline**, which is the
superset: it inlines each day's places and its activities with their GPS track,
so nothing has to be joined across files.

```
json/daily/storyline/storyline_YYYYMMDD.json   one day per file
json/full/storyline.json                       every day in one array
```

`--input` accepts the export folder, its `json` folder, the daily storyline
folder, or a storyline JSON file directly — the extractor resolves it. The daily
folder wins when both are present, because a windowed or limited run then only
opens the files it needs.

A day is an ordered list of segments, and a segment is one of:

- `place` — a stay: the place it was at, plus any activity recorded there
- `move` — movement between two stays, split into legs
- `off` — tracking was off, but the phone still recorded activity

A `move`/`off` segment splits into legs: walk to the station, take the train,
walk to the office is one segment of three activities, each with its own type,
distance, and track. The leg is the unit that carries a single mode of travel,
so the leg — not the segment — is what becomes a journey. The extractor emits
one record per stay and one per leg:

- `recordType: "places"` for stays
- `recordType: "moves"` for legs of movement

A segment that spans midnight is written into both days' files. It is deduped on
its start time, which is also its identity downstream, so both copies land on one
record.

## Schema

| Source             | Chronicle                                                                            |
| ------------------ | ------------------------------------------------------------------------------------ |
| `place` segment    | `VisitAction` → `object: Venue` or `Place`, `startTime`/`endTime`                    |
| leg of movement    | `TravelAction` → `Journey` (`travelMode`, `distance`, `path`), `startTime`/`endTime` |
| `place` dictionary | `Venue`/`Place` (name, coordinates, `sameAs` to Foursquare/Facebook)                 |

The source is `moves-app`, after the service's own domain (`moves-app.com`, and
`dev.moves-app.com` for the format docs the export's PDF points at). Not bare
`moves`: a source name is a namespace, and it sits beside `moves` the record
type. Not `facebook-moves` either, though Facebook bought the company in 2014 —
these ids were minted by the Moves service throughout, and the same place
records carry `facebookPlaceId` values that belong to the genuinely separate
`facebook` id space.

Moves numbered its places but never its segments, so a stay and a leg are keyed
on the instant they began — a person is in one place, and on one leg of one
journey, at a time. The start is spelled as a UTC ISO string so it hashes the
same on every replica, and the type is part of the keyset, so a stay, the leg
that ended it, and that leg's `Journey` never collide.

A place keys on the Moves place id, which Moves issued and reused on every
visit. A named one is a `Venue`; an unnamed one (a spot Moves detected but never
named) is a `Place`. Where Moves matched a place against Foursquare or Facebook
it kept that service's id, which becomes a `sameAs` edge — so the Moves venue
collapses onto the same entity as that service's own `Venue`, the way an Arc
Timeline place does.

A leg's `activity` becomes the journey's `travelMode`, in the words Chronicle
already uses for those modes (Moves' `underground` is written `metro`, as Arc
Timeline writes it). Where Moves has no counterpart its own word stands:
`transport` is Moves saying "motorized, but I could not tell which", and
narrowing it to a car would be an invention. A leg's GPS `trackPoints` become
the journey's `path`, a GeoJSON `LineString` with per-point times in
`properties.coordTimes`.

The export carries no account identity — no name, no handle, no user id — so the
self is the per-source singleton, merged onto the real person through `@me`.

### Not ingested

- **Steps and calories.** Moves counted both, per leg and per day, and neither
  has a home in the schema today.
- **Activity recorded while at a place.** Moves logged the walking done inside a
  venue as an activity on the `place` segment. It has no track and goes
  nowhere — it is a step count, which is the point above.
- **Foursquare category ids.** The export carries the ids, not the names, and a
  raw id is not a category anyone can read.
- **A place's `type`** (`home`, `work`, `user`) — Moves' note on where the place
  came from, which has no schema property.
- **The other cuts and roll-ups.** `places`, `activities`, and `summary` are
  projections of the storyline; the weekly, monthly, and yearly folders are the
  same days re-bucketed.

## Development

```bash
npm install
npm run build
npm test
```

Tests use a small synthetic export written to a temporary folder, so they never
read the host's Moves data or any account.
