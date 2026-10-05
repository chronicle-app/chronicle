# Google Calendar shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## events

```ts
PlanAction key(sourceId) {
  sourceId, timestamp
  agent: Agent key(handle) { handle, name, sameAs[]? }
  object: Event key(sourceId) {
    sourceId, name, description?
    scheduledTime: Interval { startTime, endTime* }
    isPartOf[]: Collection key(sourceId) { sourceId, name }
    attendee[]?: Agent key(handle) { handle, name, sameAs[]? }
    location?: Location { address }
  }
}
```
