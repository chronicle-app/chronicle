# Chronicle persistence

The Chronicle store: a log of the payloads `chronicle extract` writes, and the
entities, properties and actions folded from it, on `node:sqlite`.
`processEventBatch` imports payloads, and `queryPage` and `queryCount` answer
CQL from `@chronicle.app/cql`. Open a store with `openDatabase` from
`@chronicle.app/persistence/node`. Requires Node.js 22.16 or newer.
