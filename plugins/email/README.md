# @chronicle.app/email

Chronicle plugin for email

## Installation

```bash
npm install @chronicle.app/email
```

## Usage

### Basic extraction

```bash
chronicle extract email --input /path/to/emails.mbox
```

### With date filtering

```bash
chronicle extract email \
  --input /path/to/emails.mbox \
  --since 2024-01-01 \
  --until 2024-12-31 \
  --limit 1000
```

## Configuration

The extractor supports the following options:

- `--input` (required): Path to the mbox file
- `--since`: Extract records from this date onwards
- `--until`: Extract records up to this date
- `--limit`: Maximum number of records to extract

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Run the tests
npm test
```

## File Format

This plugin processes email data in the mbox format, which is a standard format for storing email messages in a single file. Each message starts with a "From " line and contains standard email headers followed by the message body.

The extractor parses the following email components:

- From, To, CC, BCC addresses
- Subject line
- Date sent
- Message ID
- Full message body
- All email headers

## Schema

The plugin generates Chronicle records of type `email` with the following data structure:

- Sender and recipient information
- Message metadata (subject, date, message ID)
- Complete message content and headers
- Proper date/time handling for filtering and chronological ordering

## Tests

The tests write a small synthetic mbox file with made-up addresses to a
temporary directory and run it through the extractor and transformer. They
never read the host's mail or accounts.
