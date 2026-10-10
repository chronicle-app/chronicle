# Shazam shapes

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
ListenAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: MusicRecording key(sourceId) {
    sourceId, name, duration?, genre[]?, datePublished?
    artist[]: MusicGroup key(name) { name }
    inAlbum?: MusicAlbum key(sourceId) { sourceId, name }
    emblem?: ImageObject key(url, any source) { url, width, height }
    sameAs[]?: MusicRecording key(sourceId) { sourceId, url? }
  }
  location?: Location { latitude, longitude }
}
```
