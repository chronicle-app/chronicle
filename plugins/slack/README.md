# @chronicle.app/slack

Chronicle plugin for Slack message history, read from a [slackdump](https://github.com/rusq/slackdump) export directory.

## Exporting your data

Slack's own export supports public channels on all plans, including Free. Business+ and Enterprise also support private-channel and DM exports with the appropriate access; see [Slack's export documentation](https://slack.com/help/articles/201658943-Export-your-workspace-data). [slackdump](https://github.com/rusq/slackdump) exports conversations your account can access — public and private channels, DMs, and group DMs (mpims) — to a local directory.

```bash
# Authenticate and export in Slack-export layout
slackdump export -o my-slack-export
```

This produces a directory like:

```
my-slack-export/
├── channels.json          # public/private channels
├── dms.json               # direct messages
├── mpims.json             # group DMs
├── users.json             # workspace members
├── <channel-name>/        # one dir per conversation
│   ├── 2024-03-13.json     #   messages, one file per day
│   └── attachments/        #   downloaded files (if exported)
└── attachments/           # top-level aggregate of all files
```

Attachments are only present on disk if you exported them with slackdump. Chronicle includes attachment metadata only when `--attachments` is enabled; otherwise attachments are omitted entirely. With that flag, extraction includes a `contentPath` for files found locally. Files not found locally are recorded as metadata only. Extraction does not store attachment bytes.

## Usage

```bash
# Extract to stdout (Chronicle JSON-LD)
chronicle extract slack --input ./my-slack-export

# Include file attachments (with a contentPath for downloaded files)
chronicle extract slack --input ./my-slack-export --attachments
```

Use `--since` / `--until` for incremental or windowed extraction:

```bash
chronicle extract slack --input ./my-slack-export --since 2024-01-01
```

## Configuration

- `--input` (required): path to the slackdump export directory
- `--attachments`: include file attachments (default: false)
- `--since`: only extract messages on or after this date
- `--until`: only extract messages on or before this date
- `--limit`: maximum number of records to extract (default 100; 0 for no limit)

## Schema

This plugin maps Slack data onto the following Chronicle types:

- **Messages** → `MessageAction` whose `object` is a `Message` (`source: slack`, `body`, `author`, `recipient`)
- **Users** → `Agent` (resolved to a `handle` and `name` from `users.json`, group-DM metadata, and message profiles)
- **File attachments** → `ImageObject` / `AudioObject` / `VideoObject` / `DocumentObject` (by MIME type), with `contentPath` to the locally exported file when available

Recipients are inferred from the conversation type: a DM addresses the other person, a group DM addresses every other member, a small private channel addresses its members, and a public/large channel is treated as a broadcast (no recipients).

## Development

```bash
# Build the plugin
npm run build -w @chronicle.app/slack

# Typecheck and lint
npm run typecheck -w @chronicle.app/slack
npm run lint -w @chronicle.app/slack

# Run tests
npm run test -w @chronicle.app/slack
```

Tests build a small synthetic slackdump export (made-up users, channels, DMs,
and a group DM) in a temporary directory, so they never read the host's Slack
data or accounts and never touch the network.
