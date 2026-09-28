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

- Each email is a `MessageAction` by the sender whose object is a `Message`.
  The message's `name` is the subject, its `description` is the body, and its
  `recipient`s are the To, CC and BCC addresses.
- Each address is an `Agent` whose `handle` is the email address and whose
  `name` is the display name, or the address when there is none.

The source is `email`. A message with a Message-ID uses it as its `sourceId`;
one without is identified by its sender, date and subject.

## Tests

The tests write a small synthetic mbox file with made-up addresses to a
temporary directory and run it through the extractor and transformer. They
never read the host's mail or accounts.
