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

These sources come bundled with the CLI:

| Source                                           | Package                                      |
| ------------------------------------------------ | -------------------------------------------- |
| Shell history (bash, zsh, fish)                  | [shell](plugins/shell/README.md)             |
| iMessage/SMS, with iCloud and contact enrichment | [imessage](plugins/imessage/README.md)       |
| Safari browsing history                          | [safari](plugins/safari/README.md)           |
| Claude Code transcripts                          | [claude-code](plugins/claude-code/README.md) |
| Things 3                                         | [things-todo](plugins/things-todo/README.md) |

Install other plugins with `chronicle plugins install <package>`.

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
