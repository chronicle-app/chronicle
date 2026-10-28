# Chrome shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## views

```ts
ViewAction key(@type, source, object.url, timestamp) {
  timestamp*
  agent?: Agent key(@type, source, handle) {
    handle, name
    sameAs[]: Agent key(@type, source, handle) { handle }
  }
  object: Entity key(url) { url, name }
}
// Some records also become:
NavigateAction key(@type, source, target.url, timestamp) {
  timestamp*
  agent?: Agent key(@type, source, handle) {
    handle, name
    sameAs[]: Agent key(@type, source, handle) { handle }
  }
  object: Entity key(url) {
    url
    references[]?: Entity key(url) { url }
  }
  target: Entity key(url) { url }
}
```
