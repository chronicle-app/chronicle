# Apple Notes shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## notes

```ts
UpdateAction key(@type, source, object.sourceId, timestamp) {
  timestamp
  object: Note key(@type, source, sourceId) {
    sourceId, name, body?, tags[]?
    isPartOf[]: Collection key(@type, source, inAccount[*].sourceId, sourceId) {
      sourceId, name
      inAccount[]: Person key(@type, source, sourceId) {
        sourceId, name
        sameAs[]: Agent | Person key(@type, source, handle) / key(source, sourceId) { handle?*, sourceId?*, name? }
      }
    }
    contains[]?: DocumentObject | ImageObject key(@type, source, sourceId) { sourceId, name?, contentPath }
  }
  agent?: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
}
// Every record also becomes:
CreateAction key(@type, source, result.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) {
    sourceId*, name?, handle?
    sameAs[]: Agent | Person key(@type, source, handle) / key(source, sourceId) { handle?*, sourceId?*, name? }
  }
  result: Note key(@type, source, sourceId) { sourceId, name }
}
```

## edits

```ts
UpdateAction key(@type, source, object.sourceId, agent.sourceId, startTime) {
  startTime, endTime
  object: Note key(@type, source, sourceId) { sourceId, name }
  result: Changeset key(@type, source, action.object.sourceId, action.agent.sourceId, action.startTime) {
    body
    isPartOf[]: Note key(@type, source, sourceId) { sourceId, name }
  }
  agent?: Person key(@type, source, sourceId) {
    sourceId*, handle?, name?
    sameAs[]: Agent | Person key(@type, source, handle) / key(source, sourceId) { handle?*, sourceId?, name? }
  }
}
```
