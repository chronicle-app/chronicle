# Chronicle

Extract your digital history into a shared vocabulary:

```sh
chronicle extract <source>
```

Chronicle brings records from different services into a common JSON-LD representation.
A **source** is the service, application, or export your records come from. A **plugin**
contains the code that reads those records and transforms them. The **schema** defines
the shared types and properties that make records from different sources understandable
together.

## Repository status

This repository contains shared TypeScript, ESLint, Prettier, and logging packages, plus a
[minimal schema](core/schema/README.md) with generated TypeScript/Zod validators and
a [standalone ETL framework](core/etl/README.md) for extraction and serialization.
Source plugins are available as programmatic extractors and transformers.
The CLI has not moved here yet, so the extraction command above is not runnable
from this checkout. Packages are prepared for release but are not
published by this repository's workflows.

## Source plugins

| Source                                           | Package                                      |
| ------------------------------------------------ | -------------------------------------------- |
| Things 3                                         | [things-todo](plugins/things-todo/README.md) |
| Shell history (bash, zsh, fish)                  | [shell](plugins/shell/README.md)             |
| iMessage/SMS, with iCloud and contact enrichment | [imessage](plugins/imessage/README.md)       |
| Claude Code transcripts                          | [claude-code](plugins/claude-code/README.md) |

SQLite sources use the [read-only Node SQLite adapter](core/etl-sqlite/README.md).
Each plugin exports an extractor and transformer for use with the ETL Runner.
Tests use synthetic files and databases; they do not need access to personal data.

## Development

Use Node.js 22.13.0 or newer and npm. With nvm:

```sh
nvm install
npm ci
npm run quality
```

The workspace layout is:

| Directory   | Contents                                                    |
| ----------- | ----------------------------------------------------------- |
| `core/`     | Shared schema, extraction foundations, and tooling packages |
| `packages/` | Reusable libraries                                          |
| `apps/`     | Applications, including the CLI                             |
| `plugins/`  | Source plugins                                              |
| `tools/`    | Development tools                                           |

TypeScript builds use the root solution's project references. Add new library projects
to `tsconfig.json`; TypeScript orders referenced dependencies. Workspace lint, typecheck,
and test scripts run through npm. Shared configuration lives in `core/tsconfig`,
`core/eslint-config`, and `core/prettier-config`.

Run `npm run packages:check` after `npm run quality` to validate packed packages in
an isolated consumer. See [Preparing a release](RELEASING.md) for artifacts and
publishing.

## License

The tooling in this repository is covered by the [MIT license](LICENSE).
