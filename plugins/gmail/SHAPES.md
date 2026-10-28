# Gmail shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## messages

```ts
MessageAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, handle) {
    handle, alternateName[]
    sameAs[]?: Agent key(@type, source, handle) { handle }
  }
  result: Message key(@type, source, sourceId) {
    sourceId*, name, body, tags[]
    inAccount[]: Agent key(@type, source, handle) { handle }
    author[]: Agent key(@type, source, handle) { handle }
    recipient[]: Agent key(@type, source, handle) {
      handle, alternateName[]?
      sameAs[]?: Agent key(@type, source, handle) { handle }
    }
    inReplyTo[]?: Message key(@type, source, sourceId) { sourceId* }
    isPartOf[]: Thread key(@type, source, inAccount[*].handle, sourceId) {
      sourceId
      inAccount[]: Agent key(@type, source, handle) { handle }
    }
  }
}
```
