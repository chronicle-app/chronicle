# Chronicle

**Own your data, own your history.**

Chronicle is an open-source, local-first [memex](https://hyfen.net/memex/) that archives
and indexes your digital history, so that your personal records are yours to keep and to search.

Today, Chronicle is a command-line tool that extracts your data from apps and services
into a common JSON-LD format. It reads files and databases on your machine and writes to
stdout.

## Install

```sh
npm install -g @chronicle.app/cli
```

To run without installing, use `npx @chronicle.app/cli@latest <command>`.

## Usage

```sh
chronicle sources                                          # list available sources
chronicle extract shell --limit 10                         # 10 shell history records
chronicle extract things-todo --type tasks                 # one record type
chronicle extract claude-code --loader yaml --output sessions.yaml
```

- Output is JSON by default. Use `--loader csv`, `yaml`, or `table` to change it.
- `--output <file>` writes to a file instead of stdout.
- `--limit` defaults to 100. `--limit 0` reads everything.

Run `chronicle extract <source> --help` for a source's options. See the
[CLI README](apps/cli/README.md) for more.

## Sources

The CLI bundles shell, imessage, safari, things-todo, and claude-code. Install any
other source by name, for example `chronicle plugins install lastfm`, or let
`chronicle extract <source>` offer to install it.

<!-- sources:start -->

<!-- Generated from catalog.json and plugin manifests: npm run readme:sources -->

| Source                                                                | Package                                                    | Strategies                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| Claude Code transcripts                                               | [claude-code](plugins/claude-code/README.md)               | transcripts (local)             |
| iMessage/SMS, with iCloud and contact enrichment                      | [imessage](plugins/imessage/README.md)                     | app-db (local)                  |
| Safari browsing history                                               | [safari](plugins/safari/README.md)                         | app-db (local)                  |
| Shell history (bash, zsh, fish)                                       | [shell](plugins/shell/README.md)                           | history (local)                 |
| Things 3                                                              | [things-todo](plugins/things-todo/README.md)               | app-db (local)                  |
| Phone and FaceTime calls (Apple Call History)                         | [apple-call-history](plugins/apple-call-history/README.md) | app-db (local)                  |
| Arc Timeline visits and trips                                         | [arc-timeline](plugins/arc-timeline/README.md)             | icloud-backup (local)           |
| Are.na channels, blocks, comments, and follows                        | [arena](plugins/arena/README.md)                           | api                             |
| Bluesky follows, followers, and likes                                 | [bluesky](plugins/bluesky/README.md)                       | api                             |
| Email from mbox files                                                 | [email](plugins/email/README.md)                           | mbox (export)                   |
| Facebook export                                                       | [facebook](plugins/facebook/README.md)                     | archive (export)                |
| FoodNoms meal logs                                                    | [foodnoms](plugins/foodnoms/README.md)                     | app-db (local)                  |
| Foursquare/Swarm check-ins                                            | [foursquare](plugins/foursquare/README.md)                 | api                             |
| Goodreads shelves and reading history                                 | [goodreads](plugins/goodreads/README.md)                   | csv (export)                    |
| Google Calendar events                                                | [google-calendar](plugins/google-calendar/README.md)       | api                             |
| GitHub pull requests, issues, comments, reviews, stars, and gists     | [github](plugins/github/README.md)                         | api                             |
| Gmail messages, threads, and labels                                   | [gmail](plugins/gmail/README.md)                           | api, takeout (export)           |
| Hacker News submissions, comments, and replies                        | [hackernews](plugins/hackernews/README.md)                 | api                             |
| Instagram data export                                                 | [instagram](plugins/instagram/README.md)                   | archive (export)                |
| Last.fm listens, loved tracks, and friends                            | [lastfm](plugins/lastfm/README.md)                         | api                             |
| LinkedIn data export                                                  | [linkedin](plugins/linkedin/README.md)                     | archive (export)                |
| Obsidian notes and links                                              | [obsidian](plugins/obsidian/README.md)                     | vault (local)                   |
| Pinboard bookmarks                                                    | [pinboard](plugins/pinboard/README.md)                     | api                             |
| Slack messages from a slackdump export                                | [slack](plugins/slack/README.md)                           | archive (export)                |
| Spotify listens, saved tracks and albums, playlists                   | [spotify](plugins/spotify/README.md)                       | api                             |
| Timing app usage, time entries, and calls                             | [timing-app](plugins/timing-app/README.md)                 | app-db (local)                  |
| Twitter/X archive tweets, likes, and DMs                              | [twitter](plugins/twitter/README.md)                       | archive (export)                |
| WhatsApp messages                                                     | [whatsapp](plugins/whatsapp/README.md)                     | app-db (local), backup (export) |
| YouTube likes, subscriptions, playlists, uploads, and Takeout history | [youtube](plugins/youtube/README.md)                       | api, takeout (export)           |
| Zotero works, highlights, notes, and reading                          | [zotero](plugins/zotero/README.md)                         | app-db (local)                  |

For services that no longer exist, shown by `chronicle sources --all`:

| Source                                 | Package                                          | Strategies            |
| -------------------------------------- | ------------------------------------------------ | --------------------- |
| Google Reader archive actions          | [google-reader](plugins/google-reader/README.md) | takeout (export)      |
| Marvin reading sessions and highlights | [marvin](plugins/marvin/README.md)               | csv (export)          |
| Moves export places and moves          | [moves-app](plugins/moves-app/README.md)         | moves-export (export) |

<!-- sources:end -->

`chronicle plugins install` also takes a package name or a local path.
`chronicle plugins new my-source` creates a plugin of your own for a source, and
`chronicle plugins add ./my-source` runs one you're writing in place.
`chronicle plugins` lists what is installed.

## Why

Imagine if your complete personal history was accessible to you in a single, unified
archive: one place to search everything you've messaged, read, watched, and listened to.

In 1945, [the Memex](https://en.wikipedia.org/wiki/Memex) was supposed to be this
device, but it was never built. Chronicle is the open-source adaptation of an
experimental personal project that attempted to build a modern-day memex.
[Read the full story](https://hyfen.net/memex/).

- **Local-first.** Your data stays on your machine and never touches a third-party
  service.
- **Open-source.** You can inspect everything that touches your data.
- **Connected.** Records from different sources share one schema, so they can be linked
  and searched together.

## Roadmap

Available now:

- **Extract.** Read records from a source and output them as JSON-LD.

Planned:

- **Archive.** Import extracted records into a local archive.
- **Query.** Search across everything in the archive.
- **Sync.** Keep the archive in sync across devices.

## How it works

- A **source** is where records come from: a service, an application, or an export.
- A **plugin** reads records from a source and transforms them to the schema.
- The **schema** ([core/schema](core/schema/README.md)) defines the shared types and
  properties.

Each plugin exports an extractor and a transformer. You can use them from code with the
[ETL framework](core/etl/README.md). SQLite sources use the
[read-only SQLite adapter](core/etl-sqlite/README.md). All packages are published to npm
under `@chronicle.app`.

## Development

Requires Node.js 22.13.0 or newer.

```sh
nvm install
npm ci
npm run quality
```

| Directory   | Contents                                  |
| ----------- | ----------------------------------------- |
| `core/`     | Schema, ETL framework, and shared tooling |
| `packages/` | Reusable libraries                        |
| `apps/`     | Applications, including the CLI           |
| `plugins/`  | Source plugins                            |
| `tools/`    | Development tools                         |

Tests use synthetic fixtures, not personal data. After changing packages or
dependencies, run `npm run packages:check` to test the packed packages in an isolated
install. See [RELEASING.md](RELEASING.md) for publishing.

## License

[MIT](LICENSE)
