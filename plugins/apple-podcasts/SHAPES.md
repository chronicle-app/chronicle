# Apple Podcasts shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## listens

```ts
ListenAction | BookmarkAction key(@type, source, object.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: PodcastEpisode key(@type, source, sourceId) {
    sourceId, name?, url, duration*, datePublished, description?*, transcript?
    rendition[]: AudioObject key(url) { url }
    series[]: PodcastSeries key(@type, source, sourceId) {
      sourceId, url, name?, description?, webFeed[], genre[]?
      references[]?: Entity key(url) { url }
      emblem?: ImageObject key(url) { url }
      author[]?: Agent key(@type, source, name) { name }
      publisher[]?: Organization key(@type, source, sourceId) { sourceId, url, name }
    }
    author[]?: Agent key(@type, source, name) { name }
    references[]?: Entity key(url) { url }
    emblem?: ImageObject key(url) { url* }
  }
}
// Some records also become:
CompleteAction key(@type, source, object.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: PodcastEpisode key(@type, source, sourceId) {
    sourceId, name?, url, duration*, datePublished, description?*, transcript?
    rendition[]: AudioObject key(url) { url }
    series[]: PodcastSeries key(@type, source, sourceId) {
      sourceId, url, webFeed[], name?, description?, genre[]?
      references[]?: Entity key(url) { url }
      emblem?: ImageObject key(url) { url }
      author[]?: Agent key(@type, source, name) { name }
      publisher[]?: Organization key(@type, source, sourceId) { sourceId, url, name }
    }
    references[]?: Entity key(url) { url }
    emblem?: ImageObject key(url) { url* }
    author[]?: Agent key(@type, source, name) { name }
  }
}
// Some records also become:
BookmarkAction key(@type, source, object.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: PodcastEpisode key(@type, source, sourceId) {
    sourceId, name, description*, url, duration, datePublished, transcript
    references[]: Entity key(url) { url }
    emblem: ImageObject key(url) { url* }
    rendition[]: AudioObject key(url) { url }
    series[]: PodcastSeries key(@type, source, sourceId) {
      sourceId, url, name, description, webFeed[], genre[]
      references[]: Entity key(url) { url }
      emblem: ImageObject key(url) { url }
      author[]: Agent key(@type, source, name) { name }
      publisher[]: Organization key(@type, source, sourceId) { sourceId, url, name }
    }
    author[]: Agent key(@type, source, name) { name }
  }
}
```

## subscriptions

```ts
FollowAction key(@type, source, object.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: PodcastSeries key(@type, source, sourceId) {
    sourceId, url, name, description, webFeed[], genre[]
    references[]: Entity key(url) { url }
    emblem: ImageObject key(url) { url }
    author[]: Agent key(@type, source, name) { name }
    publisher[]: Organization key(@type, source, sourceId) { sourceId, url, name }
  }
}
```
