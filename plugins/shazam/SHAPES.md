# Shazam shapes

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
ListenAction key(@type, source, sourceId) {
  sourceId, timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: MusicRecording key(@type, source, sourceId) {
    sourceId, name, duration?, genre[]?, datePublished?
    artist[]: MusicGroup key(@type, source, name) { name }
    inAlbum?: MusicAlbum key(@type, source, sourceId) { sourceId, name }
    emblem?: ImageObject key(url) { url, width, height }
    sameAs[]?: MusicRecording key(@type, source, sourceId) { sourceId, url? }
  }
  location?: Location { latitude, longitude }
}
```
