# Google Contacts shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## contacts

```ts
UpdateAction key(object.sourceId, timestamp) {
  timestamp, @asserts[]
  agent: Person key(@type) { sameAs[], @asserts[] }
  object: Person key(sourceId) {
    sourceId, name, description?*, url, tags[]?, @asserts[]
    emblem?: ImageObject key(url, any source) { url, @asserts[] }
    memberOf[]?: Organization key(name) { name, @asserts[] }
    sameAs[]: Agent key(handle) { handle*, @asserts[] }
  }
}
```
