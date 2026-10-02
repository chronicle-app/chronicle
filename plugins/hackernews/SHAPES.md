# Hacker News shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## submissions

```ts
PublishAction key(sourceId) {
  sourceId, timestamp
  agent: Agent key(handle) { handle, sameAs[], url, description }
  object: Post key(sourceId) {
    sourceId, url, name, body?*
    author[]: Agent key(handle) { handle, sameAs[], url, description }
    references[]?: Entity key(url, any source) { url }
  }
}
```

## comments

```ts
RespondAction key(sourceId) {
  sourceId, timestamp
  agent: Agent key(handle) { handle, sameAs[], url, description }
  object: Comment | Post key(sourceId) {
    sourceId, url, body?, name?
    author[]: Agent key(handle) { handle, url, sameAs[]?, description? }
    about[]?: Post key(sourceId) {
      sourceId, url, name
      author[]: Agent key(handle) { handle, sameAs[], url, description }
      references[]: Entity key(url, any source) { url }
    }
    references[]?: Entity key(url, any source) { url }
  }
  result: Comment key(sourceId) {
    sourceId, url, body*
    author[]: Agent key(handle) { handle, sameAs[], url, description }
    about[]: Post key(sourceId) {
      sourceId, url, name
      author[]: Agent key(handle) { handle, sameAs[]?, url, description? }
      references[]: Entity key(url, any source) { url }
    }
  }
}
```

## replies

```ts
RespondAction key(sourceId) {
  sourceId, timestamp
  agent: Agent key(handle) { handle, url }
  object: Comment | Post key(sourceId) {
    sourceId, url, body?, name?
    author[]: Agent key(handle) { handle, sameAs[], url, description }
    about[]?: Post key(sourceId) {
      sourceId, url, name
      author[]: Agent key(handle) { handle, url }
      references[]: Entity key(url, any source) { url }
    }
    references[]?: Entity key(url, any source) { url }
  }
  result: Comment key(sourceId) {
    sourceId, url, body*
    author[]: Agent key(handle) { handle, url }
    about[]: Post key(sourceId) {
      sourceId, url, name
      author[]: Agent key(handle) { handle, url, sameAs[]?, description? }
      references[]: Entity key(url, any source) { url }
    }
  }
}
```
