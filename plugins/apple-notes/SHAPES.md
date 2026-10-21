# Apple Notes shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## notes

```ts
CreateAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) {
    sourceId*, name?, handle?
    sameAs[]: Agent | Person key(handle) / key(sourceId) { handle?*, sourceId?*, name? }
  }
  result: Note key(sourceId) {
    sourceId, name, body?, tags[]?
    isPartOf[]: Collection key(sourceId) { sourceId, name }
    contains[]?: ImageObject key(sourceId) { sourceId, contentPath }
  }
}
```

## edits

```ts
UpdateAction key(object.sourceId, agent.sourceId, startTime) {
  startTime, endTime
  object: Note key(sourceId) { sourceId, name }
  result: Changeset key(action.object.sourceId, action.agent.sourceId, action.startTime) {
    body
    isPartOf[]: Note key(sourceId) { sourceId, name }
  }
  agent?: Person key(sourceId) {
    sourceId*, handle?, name?
    sameAs[]: Agent | Person key(handle) / key(sourceId) { handle?*, sourceId?, name? }
  }
}
```
