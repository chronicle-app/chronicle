# Google Calendar shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## events

```ts
PlanAction key(@type, source, object.sourceId) {
  timestamp
  agent: Agent key(@type, source, handle) {
    handle, alternateName[]?
    sameAs[]?: Agent key(@type, source, handle) { handle }
  }
  object: Event key(@type, source, sourceId) {
    sourceId, name, description?, scheduledStart, scheduledEnd*
    sameAs[]: Event key(@type, source, sourceId) { sourceId* }
    location?: Location { address }
    isPartOf[]: Calendar key(@type, source, sourceId) {
      sourceId, name?
      inAccount[]?: Agent key(@type, source, handle) { handle }
    }
    attendee[]?: Agent key(@type, source, handle) {
      handle, alternateName[]
      sameAs[]?: Agent key(@type, source, handle) { handle }
    }
  }
}
```
