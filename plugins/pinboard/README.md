# @chronicle.app/pinboard

Chronicle plugin for pinboard

## Installation

```bash
npm install @chronicle.app/pinboard
```

## Usage

### Basic extraction

```bash
chronicle extract pinboard --api-key YOUR_API_KEY
```

### With date filtering

```bash
chronicle extract pinboard \
  --api-key YOUR_API_KEY \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

## Configuration

The extractor supports the following options:

- `--api-key`: API key for authentication, in Pinboard's `username:TOKEN`
  form. Without it, the key stored by `chronicle auth set pinboard` is used.
- `--tag-blacklist`: Tags to exclude from extraction (default: `twitterfavs`)
- `--since`: Extract records from this date onwards
- `--until`: Extract records up to this date
- `--limit`: Maximum number of records to extract

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build
```

## API Endpoints

TODO: Document the API endpoints used and response formats.

## Schema

TODO: Document what Chronicle schema types are generated from this data source.

## Tests

Tests serve synthetic posts from a local HTTP server on 127.0.0.1 and pass a
fake API key. They never call Pinboard or read stored credentials: the
credential store points at an empty temporary directory.
