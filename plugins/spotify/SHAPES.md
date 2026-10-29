# Spotify shapes

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
ListenAction key(@type, source, object.sourceId, timestamp) {
  timestamp*
  agent: Agent key(@type, source, handle) { handle, name, url, sameAs[] }
  object: MusicRecording | PodcastEpisode key(@type, source, sourceId) {
    sourceId*, url*, name, duration?*, contentUrl?
    artist[]?: MusicGroup key(@type, source, sourceId) / key(@type, source, name) { sourceId?, url?, name }
    inAlbum?: MusicAlbum key(@type, source, sourceId) / key(@type, source, name, artist[*].name) {
      sourceId?, url?, name, datePublished?
      emblem?: ImageObject key(url) { url, width, height }
      artist[]: MusicGroup key(@type, source, sourceId) / key(@type, source, name) { sourceId?, url?, name }
    }
    emblem?: ImageObject key(url) { url, width, height }
    series[]?: PodcastSeries key(@type, source, name) { name }
  }
}
```

## saved-tracks

```ts
LikeAction key(@type, source, agent.handle, object.sourceId, timestamp) / key(@type, source, agent.handle, object.sourceId) {
  timestamp?
  agent: Agent key(@type, source, handle) { handle, name, url, sameAs[] }
  object: MusicRecording key(@type, source, sourceId) {
    sourceId, url, name, duration?*, contentUrl?
    artist[]: MusicGroup key(@type, source, sourceId) / key(@type, source, name) { sourceId?, url?, name }
    inAlbum: MusicAlbum key(@type, source, sourceId) / key(@type, source, name, artist[*].name) {
      sourceId?, url?, name, datePublished?
      emblem?: ImageObject key(url) { url, width, height }
      artist[]: MusicGroup key(@type, source, sourceId) / key(@type, source, name) { sourceId?, url?, name }
    }
    emblem?: ImageObject key(url) { url, width, height }
  }
}
```

## saved-albums

```ts
LikeAction key(@type, source, agent.handle, object.sourceId, timestamp) / key(@type, source, agent.handle, object.sourceId) {
  timestamp?
  agent: Agent key(@type, source, handle) { handle, name, url, sameAs[] }
  object: MusicAlbum key(@type, source, sourceId) {
    sourceId, url, name, datePublished?
    emblem?: ImageObject key(url) { url, width, height }
    artist[]: MusicGroup key(@type, source, sourceId) / key(@type, source, name) { sourceId?, url?, name }
  }
}
```

## playlist-tracks

```ts
AddAction key(@type, source, object.sourceId, target.sourceId, timestamp) / key(@type, source, object.sourceId, target.inAccount[*].handle, target.name, timestamp) {
  timestamp
  agent: Agent key(@type, source, handle) { handle, name, url, sameAs[] }
  object: MusicRecording | PodcastEpisode key(@type, source, sourceId) {
    sourceId*, url*, name, duration?*
    artist[]?: MusicGroup key(@type, source, sourceId) / key(@type, source, name) { sourceId?, url?, name }
    inAlbum?: MusicAlbum key(@type, source, sourceId) / key(@type, source, name, artist[*].name) {
      sourceId?, url?, name, datePublished?
      artist[]?: MusicGroup key(@type, source, name) { name }
    }
    series[]?: PodcastSeries key(@type, source, name) { name }
  }
  target: Collection key(@type, source, sourceId) / key(@type, source, inAccount[*].handle, name) {
    sourceId?, url?, name, description?
    inAccount[]?: Agent key(@type, source, handle) { handle }
  }
}
```

## saved-episodes

```ts
BookmarkAction key(@type, source, agent.handle, object.sourceId) {
  agent: Agent key(@type, source, handle) { handle, name, sameAs[], url }
  object: PodcastEpisode key(@type, source, sourceId) {
    sourceId*, url*, name
    series[]: PodcastSeries key(@type, source, name) { name }
  }
}
```

## follows

```ts
FollowAction key(@type, source, agent.handle, object.sourceId) {
  agent: Agent key(@type, source, handle) { handle, name, sameAs[], url }
  object: MusicGroup | PodcastSeries key(@type, source, sourceId) {
    sourceId*, url*, name
    author[]?: Agent key(@type, source, name) { name }
  }
}
```

## searches

```ts
FindAction key(@type, source, agent.handle, object.body, timestamp) {
  timestamp*
  agent: Agent key(@type, source, handle) { handle, name, sameAs[], url }
  object: Query key(@type, source, body) { name, body }
}
```
