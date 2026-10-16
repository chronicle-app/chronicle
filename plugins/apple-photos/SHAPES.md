# Photos shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## photos

```ts
PhotographAction | RecordAction | ScreenshotAction | AddAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  location?: Location { latitude, longitude, address }
  instrument[]?: ProductModel | SoftwareApplication key(sourceId) / key(handle) { sourceId?, name*, handle?* }
  result?: ImageObject | VideoObject key(sourceId) {
    sourceId, name?, handle?, caption?, aiDescription?, tags[]?, category[]?, width?, height?, mimeType?*, duration?*
    depicts[]?: Person key(sourceId) { sourceId, name, sameAs[]? }
    isPartOf[]?: Collection key(sourceId) {
      sourceId, name
      isPartOf[]?: Collection key(sourceId) {
        sourceId, name
        isPartOf[]: Collection key(sourceId) { sourceId, name }
      }
    }
    contains[]?: VideoObject | ImageObject key(sourceId) {
      sourceId, duration?, mimeType?*
      depicts[]?: Person key(sourceId) { sourceId, name }
    }
  }
  object?: ImageObject | VideoObject key(sourceId) {
    sourceId, caption?, mimeType*, duration?*
    isPartOf[]?: Collection key(sourceId) {
      sourceId, name
      isPartOf[]: Collection key(sourceId) {
        sourceId, name
        isPartOf[]: Collection key(sourceId) { sourceId, name }
      }
    }
  }
}
```

## activity

```ts
UpdateAction | ShareAction | ViewAction | AddAction | UnlikeAction | LikeAction key(object.sourceId, timestamp) / key(object.sourceId, target.sourceId, timestamp) {
  timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: ImageObject | VideoObject key(sourceId) { sourceId }
  target?: Collection key(sourceId) {
    sourceId, name
    isPartOf[]?: Collection key(sourceId) {
      sourceId, name
      isPartOf[]: Collection key(sourceId) { sourceId, name }
    }
  }
}
```

## favorites

```ts
UpdateAction key(object.sourceId, timestamp) {
  timestamp*
  agent: Person key(sourceId) { sourceId }
  object: Person key(sourceId) {
    sourceId, handle, sameAs[]
    likes[]: ImageObject key(sourceId) { sourceId }
  }
}
```

## shared-with-you

```ts
ShareAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(handle) / key(sourceId) {
    handle, sourceId?
    sameAs[]: Agent key(handle) { handle }
  }
  recipient[]?: Person key(sourceId) / key(handle) {
    sourceId?, handle
    sameAs[]: Agent key(handle) { handle }
  }
  object: ImageObject | VideoObject key(sourceId) {
    sourceId, handle, aiDescription?, mimeType*, duration?*
    depicts[]?: Person key(sourceId) { sourceId, name }
    location?: Location { latitude, longitude }
    sameAs[]: ImageObject | VideoObject key(sourceId) { sourceId }
  }
}
```
