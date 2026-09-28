# @chronicle.app/facebook

Chronicle plugin for facebook

## Installation

```bash
npm install @chronicle.app/facebook
```

## Usage

### Basic extraction

```bash
chronicle extract facebook --input /path/to/facebook/file
```

This reads Messenger conversations, the default. Pass `--type reactions`, `--type comments` or `--type searches` for the rest of the export.

### With date filtering

```bash
chronicle extract facebook \
  --type messages \
  --input /path/to/facebook/file \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

## Configuration

The extractor supports the following options:

- `--input` (required): Path to the facebook file
- `--type` (required): What to read: `messages`, `reactions`, `comments`, or `searches`
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

## File Format

TODO: Document the expected file format and any parsing specifics.

## Schema

TODO: Document what Chronicle schema types are generated from this data source.

## Tests

Tests write a small synthetic Facebook export to a temporary directory and run
it through each extractor and the transformer. They never read the host's data
or accounts.
