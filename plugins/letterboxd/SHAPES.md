# Letterboxd shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## ratings

```ts
RespondAction key(@type, source, agent.handle, object.sourceId) / key(@type, source, result.sourceId) {
  timestamp
  agent: Person key(@type, source, handle) { handle, name, sameAs[], url }
  object: Movie key(@type, source, sourceId) {
    sourceId, name, datePublished, url
    sameAs[]: Movie key(source, sourceId) { sourceId, name }
  }
  result: Response key(@type, source, action.agent.handle, action.object.sourceId) / key(@type, source, sourceId) {
    ratingValue, bestRating, sourceId?
    author[]: Person key(@type, source, handle) { handle }
    about[]: Movie key(@type, source, sourceId) { sourceId }
  }
}
```

## reviews

```ts
RespondAction key(@type, source, result.sourceId) {
  timestamp
  agent: Person key(@type, source, handle) { handle, name, sameAs[], url }
  object: Movie key(@type, source, sourceId) {
    sourceId, name, datePublished, url
    sameAs[]: Movie key(source, sourceId) { sourceId, name }
  }
  result: Comment key(@type, source, sourceId) {
    sourceId, body, ratingValue, bestRating
    author[]: Person key(@type, source, handle) { handle }
    about[]: Movie key(@type, source, sourceId) { sourceId }
  }
}
```

## watches

```ts
WatchAction key(@type, source, sourceId) / key(@type, source, agent.handle, object.sourceId) {
  sourceId?, timestamp?, tags[]?
  agent: Person key(@type, source, handle) { handle, name, sameAs[], url }
  object: Movie key(@type, source, sourceId) {
    sourceId, name, datePublished, url?
    sameAs[]?: Movie key(source, sourceId) { sourceId, name }
  }
}
```

## likes

```ts
LikeAction key(@type, source, agent.handle, object.sourceId) {
  timestamp
  agent: Person key(@type, source, handle) { handle, name, sameAs[], url }
  object: Comment | Movie key(@type, source, sourceId) {
    sourceId, name?, datePublished?, url?
    sameAs[]?: Movie key(source, sourceId) { sourceId, name }
  }
}
```

## watchlist

```ts
BookmarkAction key(@type, source, agent.handle, object.sourceId) {
  timestamp
  agent: Person key(@type, source, handle) { handle, name, sameAs[], url }
  object: Movie key(@type, source, sourceId) { sourceId, name, datePublished }
}
```
