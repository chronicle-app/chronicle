---
'@chronicle.app/persistence': minor
'@chronicle.app/cql': minor
'@chronicle.app/cli': minor
---

Publish the store, `@chronicle.app/persistence`, and its query language, `@chronicle.app/cql`. The CLI now needs Node.js 22.16 or newer, for the full-text search and row reading the store uses in `node:sqlite`. Two experimental commands, not yet in the CLI's help, use the store: `chronicle import <source>` runs a source as `extract` does and puts its records in the store, as does `chronicle import <file>` for a file of records or piped ones, and `chronicle query <cql>` prints what matches as lines of JSON. The store is `chronicle.db` in the Chronicle data folder, `~/Library/Application Support/Chronicle` on macOS, unless `--db` or `CHRONICLE_DB` names another.
