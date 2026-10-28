# Photos shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## photos

```ts
PhotographAction | RecordAction | ScreenshotAction | AddAction key(@type, source, result.sourceId) / key(@type, source, object.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  location?: Location { latitude, longitude }
  instrument[]?: ProductModel | SoftwareApplication key(@type, source, name) / key(@type, source, handle) { name*, handle?* }
  result?: StillImage | MovingImage key(@type, source, sourceId) {
    sourceId, name?, caption?, sourceFormat?, tags[]?
    depicts[]?: Person key(@type, source, sourceId) { sourceId, name }
    isPartOf[]?: Collection key(@type, source, sourceId) {
      sourceId, name
      isPartOf[]?: Collection key(@type, source, sourceId) {
        sourceId, name
        isPartOf[]: Collection key(@type, source, sourceId) { sourceId, name }
      }
    }
    rendition[]?: ImageObject | VideoObject key(@type, source, sourceId) {
      sourceId, contentSize, handle?, width?, height?, mimeType*, duration?*
      exifData?: object { LensModel, FocalLength, FocalLengthIn35mmFilm?, FNumber, ExposureTime, PhotographicSensitivity, ExposureBiasValue, MeteringMode?, WhiteBalance, Flash, Orientation?, DigitalZoomRatio? }
    }
  }
  object?: StillImage | MovingImage key(@type, source, sourceId) {
    sourceId, caption?
    isPartOf[]?: Collection key(@type, source, sourceId) {
      sourceId, name
      isPartOf[]: Collection key(@type, source, sourceId) {
        sourceId, name
        isPartOf[]: Collection key(@type, source, sourceId) { sourceId, name }
      }
    }
    rendition[]: ImageObject | VideoObject key(@type, source, sourceId) {
      sourceId, contentSize, mimeType*, duration?*
      exifData?: object { Orientation }
    }
    location?: Location { latitude, longitude }
  }
}
```

## activity

```ts
UpdateAction | ShareAction | ViewAction | AddAction | UnlikeAction | LikeAction key(@type, source, object.sourceId, timestamp) / key(@type, source, object.sourceId, target.sourceId, timestamp) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: StillImage | MovingImage key(@type, source, sourceId) { sourceId }
  target?: Collection key(@type, source, sourceId) {
    sourceId, name
    isPartOf[]?: Collection key(@type, source, sourceId) {
      sourceId, name
      isPartOf[]: Collection key(@type, source, sourceId) { sourceId, name }
    }
  }
}
```

## favorites

```ts
LikeAction key(@type, source, object.sourceId) {
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  object: StillImage key(@type, source, sourceId) { sourceId }
}
```

## shared-with-you

```ts
ShareAction key(@type, source, object.sourceId) {
  timestamp
  agent: Person key(@type, source, handle) {
    handle
    sameAs[]: Agent key(@type, source, handle) { handle }
  }
  object: StillImage | MovingImage key(@type, source, sourceId) {
    sourceId
    rendition[]: ImageObject | VideoObject key(source, sourceId) { sourceId }
    location?: Location { latitude, longitude }
  }
  target?: Channel key(@type, source, sourceId) { sourceId }
}
```
