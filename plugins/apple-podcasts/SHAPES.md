# Apple Podcasts shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## listens

```ts
ListenAction | BookmarkAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: PodcastEpisode key(sourceId) {
    sourceId, name?, duration*, datePublished, description?*, url?, transcript?
    contains[]: AudioObject key(url, any source) { url }
    series[]: PodcastSeries key(sourceId) {
      sourceId, name?, description?, webFeed, genre[]?
      emblem?: ImageObject key(url, any source) { url }
      author[]?: Agent key(name) { name }
      publisher[]?: Organization key(sourceId) { sourceId, name }
    }
    author[]?: Agent key(name) { name }
    emblem?: ImageObject key(url, any source) { url* }
  }
}
// Some records also become:
CompleteAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: PodcastEpisode key(sourceId) {
    sourceId, name?, duration*, datePublished, description?*, url?, transcript?
    contains[]: AudioObject key(url, any source) { url }
    series[]: PodcastSeries key(sourceId) {
      sourceId, webFeed, name?, description?, genre[]?
      emblem?: ImageObject key(url, any source) { url }
      author[]?: Agent key(name) { name }
      publisher[]?: Organization key(sourceId) { sourceId, name }
    }
    emblem?: ImageObject key(url, any source) { url* }
    author[]?: Agent key(name) { name }
  }
}
// Some records also become:
BookmarkAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: PodcastEpisode key(sourceId) {
    sourceId, name, description*, url, duration, datePublished, transcript
    emblem: ImageObject key(url, any source) { url* }
    contains[]: AudioObject key(url, any source) { url }
    series[]: PodcastSeries key(sourceId) {
      sourceId, name, description, webFeed, genre[]
      emblem: ImageObject key(url, any source) { url }
      author[]: Agent key(name) { name }
      publisher[]: Organization key(sourceId) { sourceId, name }
    }
    author[]: Agent key(name) { name }
  }
}
```

## subscriptions

```ts
FollowAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: PodcastSeries key(sourceId) {
    sourceId, name, description, webFeed, genre[]
    emblem: ImageObject key(url, any source) { url }
    author[]: Agent key(name) { name }
    publisher[]: Organization key(sourceId) { sourceId, name }
  }
}
```
