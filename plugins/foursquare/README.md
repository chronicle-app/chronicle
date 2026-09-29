# @chronicle.app/foursquare

Chronicle plugin that imports your Foursquare/Swarm check-in history.

## Installation

```bash
npm install @chronicle.app/foursquare
```

## Authentication

Check-ins come from the authenticated user (`users/self/checkins`), so the
plugin needs a user OAuth access token. Register a Foursquare developer app to
get a client ID/secret, set its redirect URI to `http://127.0.0.1:7463/callback`,
then run:

```bash
chronicle auth login foursquare --client-id YOUR_ID --client-secret YOUR_SECRET
```

This stores the access token; the extractor picks it up automatically. You can
also pass a token directly with `--access-token`.

## Usage

```bash
# Uses the stored token from `auth login`
chronicle extract foursquare

# With a token and date/size filters
chronicle extract foursquare --strategy api \
  --access-token YOUR_TOKEN \
  --since 2024-01-01 \
  --limit 1000
```

## Configuration

The extractor supports the following options:

- `--access-token`: Foursquare user OAuth token (auto-retrieved from stored
  credentials if omitted)
- `--since`: Only check-ins on or after this date
- `--limit`: Maximum number of check-ins to extract

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build -w @chronicle.app/foursquare

# Run the tests
npm test -w @chronicle.app/foursquare
```

## API Endpoints

- `users/self`: the authenticated user (actor), for the check-in agent
- `users/self/checkins`: check-in history, paged (50/page) with `afterTimestamp`
  for `--since`

## Chronicle schema output

Each check-in becomes a `CheckInAction` (keyed on the check-in id, timestamped at
`createdAt`) whose:

- `agent` is an `Agent` keyed on your Foursquare user id, with name, profile
  `url`, and avatar `image`
- `object` is a `Venue` keyed on the Foursquare venue id, with `category` (the
  venue's Foursquare categories) and a nested keyless `Location` (lat/long +
  formatted address)

Because the `Venue` is keyed on `[@type, source: foursquare, sourceId]`, it
collapses onto the same entity as an Arc Timeline place that carries a `sameAs`
edge to the same Foursquare venue id.

## Tests

The tests serve synthetic `users/self` and check-in responses from a local HTTP
server on 127.0.0.1, pass a fake access token in config, and point Chronicle's
credential store at an empty temporary directory, so they never call Foursquare
or read the host's stored credentials or accounts.
