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
[minimal schema](core/schema/README.md) with generated TypeScript/Zod validators.
The CLI and source plugins have not moved here yet, so the extraction command above
is not runnable from this checkout. Packages are prepared for release but are not
published by this repository's workflows.

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
an isolated consumer. See [Preparing a release](RELEASING.md) for artifacts and the
publication/consumer handoff process.

## License

The tooling in this repository is covered by the [MIT license](LICENSE).
