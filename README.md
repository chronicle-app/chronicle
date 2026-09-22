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

This repository currently contains the monorepo tooling only. The CLI, schema, and source
plugins have not moved here yet, so the extraction command above is not runnable from this
checkout. There are no installable packages in this repository yet.

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

These directories will appear as packages are added. Build, lint, and test scripts
explicitly skip workspace execution while the repository has no packages. Root JavaScript
is linted and formatting is checked now. Typechecking uses the root TypeScript solution;
add project references to `tsconfig.json` as packages arrive. Workspace scripts run in npm
workspace order; maintain dependency order when introducing build dependencies.

Formatting, ESLint, and the TypeScript base configuration live in root files until the
shared configuration packages are added.

## License

The tooling in this repository is covered by the [MIT license](LICENSE).
