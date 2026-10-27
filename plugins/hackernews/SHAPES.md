# Hacker News shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## submissions

```ts
PublishAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, handle) { handle, sameAs[], url, description }
  result: Post key(@type, source, sourceId) {
    sourceId, url, name, body?*
    author[]: Agent key(@type, source, handle) { handle, sameAs[], url, description }
    references[]?: Entity key(url) { url }
  }
}
```

## comments

```ts
RespondAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, handle) { handle, sameAs[], url, description }
  object: Comment | Post key(@type, source, sourceId) {
    sourceId, url, body?, name?
    author[]: Agent key(@type, source, handle) { handle, url, sameAs[]?, description? }
    about[]?: Post key(@type, source, sourceId) {
      sourceId, url, name
      author[]: Agent key(@type, source, handle) { handle, sameAs[], url, description }
      references[]: Entity key(url) { url }
    }
    references[]?: Entity key(url) { url }
  }
  result: Comment key(@type, source, sourceId) {
    sourceId, url, body*
    author[]: Agent key(@type, source, handle) { handle, sameAs[], url, description }
    about[]: Post key(@type, source, sourceId) {
      sourceId, url, name
      author[]: Agent key(@type, source, handle) { handle, sameAs[]?, url, description? }
      references[]: Entity key(url) { url }
    }
  }
}
```

## replies

```ts
RespondAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, handle) { handle, url }
  object: Comment | Post key(@type, source, sourceId) {
    sourceId, url, body?, name?
    author[]: Agent key(@type, source, handle) { handle, sameAs[], url, description }
    about[]?: Post key(@type, source, sourceId) {
      sourceId, url, name
      author[]: Agent key(@type, source, handle) { handle, url }
      references[]: Entity key(url) { url }
    }
    references[]?: Entity key(url) { url }
  }
  result: Comment key(@type, source, sourceId) {
    sourceId, url, body*
    author[]: Agent key(@type, source, handle) { handle, url }
    about[]: Post key(@type, source, sourceId) {
      sourceId, url, name
      author[]: Agent key(@type, source, handle) { handle, url, sameAs[]?, description? }
      references[]: Entity key(url) { url }
    }
  }
}
```
