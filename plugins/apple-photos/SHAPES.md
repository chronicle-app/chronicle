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
PhotographAction | RecordAction | ScreenshotAction | AddAction key(result.sourceId) / key(object.sourceId) {
  timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  location?: Location { latitude, longitude }
  instrument[]?: ProductModel | SoftwareApplication key(name) / key(handle) { name*, handle?* }
  result?: StillImage | MovingImage key(sourceId) {
    sourceId, name?, caption?, sourceFormat?, tags[]?
    depicts[]?: Person key(sourceId) { sourceId, name }
    isPartOf[]?: Collection key(sourceId) {
      sourceId, name
      isPartOf[]?: Collection key(sourceId) {
        sourceId, name
        isPartOf[]: Collection key(sourceId) { sourceId, name }
      }
    }
    rendition[]?: ImageObject | VideoObject key(sourceId) {
      sourceId, contentSize, handle?, width?, height?, mimeType*, duration?*
      exifData?: object { LensModel, FocalLength, FocalLengthIn35mmFilm?, FNumber, ExposureTime, PhotographicSensitivity, ExposureBiasValue, MeteringMode?, WhiteBalance, Flash, Orientation?, DigitalZoomRatio? }
    }
  }
  object?: StillImage | MovingImage key(sourceId) {
    sourceId, caption?
    isPartOf[]?: Collection key(sourceId) {
      sourceId, name
      isPartOf[]: Collection key(sourceId) {
        sourceId, name
        isPartOf[]: Collection key(sourceId) { sourceId, name }
      }
    }
    rendition[]: ImageObject | VideoObject key(sourceId) {
      sourceId, contentSize, mimeType*, duration?*
      exifData?: object { Orientation }
    }
    location?: Location { latitude, longitude }
  }
}
```

## activity

```ts
UpdateAction | ShareAction | ViewAction | AddAction | UnlikeAction | LikeAction key(object.sourceId, timestamp) / key(object.sourceId, target.sourceId, timestamp) {
  timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: StillImage | MovingImage key(sourceId) { sourceId }
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
LikeAction key(object.sourceId) {
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  object: StillImage key(sourceId) { sourceId }
}
```

## shared-with-you

```ts
ShareAction key(object.sourceId) {
  timestamp
  agent: Person key(handle) {
    handle
    sameAs[]: Agent key(handle) { handle }
  }
  object: StillImage | MovingImage key(sourceId) {
    sourceId
    rendition[]: ImageObject | VideoObject key(sourceId) { sourceId }
    location?: Location { latitude, longitude }
  }
  target?: Channel key(sourceId) { sourceId }
}
```
