# @chronicle.app/twitter

Chronicle plugin for twitter

## Installation

```bash
npm install @chronicle.app/twitter
```

## Usage

### Basic extraction

```bash
chronicle extract twitter --input /path/to/twitter/export
```

### With date filtering

```bash
chronicle extract twitter \
  --input /path/to/twitter/export \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

## Configuration

The extractor supports the following options:

- `--input` (required): Path to the Twitter export data directory
- `--type`: Which record types to read: `tweets`, `likes`, `direct-messages`,
  `group-direct-messages` (default: all of them)
- `--include-group-dms`: Include group direct messages (default: true)
- `--since`: Extract records from this date onwards
- `--until`: Extract records up to this date
- `--limit`: Maximum number of records to extract

## Development

```bash
# Build the plugin
npm run build

# Run the tests
npm test
```

## File Format

The input is the unzipped directory of a Twitter/X data archive. The plugin
reads these files from its `data/` folder, each a `window.YTD.<name>.part0 = [...]`
script wrapping a JSON array:

- `account.js`: the archive owner's account ID, username, and display name
- `tweets.js`: your tweets
- `like.js`: the tweets you liked
- `direct-messages.js`: one-to-one direct messages
- `direct-messages-group.js` and `direct-message-group-headers.js`: group direct
  messages and their participants

## Schema

- Each tweet is a `PublishAction` whose object is a `Post`. The post's
  `references` are the accounts it mentions and the links it contains.
- Each like is a `LikeAction` on the liked `Post`.
- Each direct message is a `MessageAction` whose object is a `Message`, sent to
  the other participants of the conversation.

The archive owner is an `Agent` linked to `@me`; other accounts are `Agent`s
keyed by their Twitter user ID.

Tests build a small synthetic archive in a temporary directory and never read
the host's data or accounts.
