# Email shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## emails

```ts
MessageAction key(sourceId) / key(timestamp, agent.handle, object.name) {
  sourceId?, timestamp
  agent: Agent key(handle) { handle, alternateName[] }
  object: Message key(sourceId) / key(action.timestamp, action.agent.handle, name) {
    sourceId?, name, body
    author[]: Agent key(handle) { handle }
    recipient[]: Agent key(handle) { handle, alternateName[]? }
  }
}
```
