# GitHub shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## pull-requests

```ts
PublishAction key(@type, source, result.isPartOf[*].creator[*].handle, result.isPartOf[*].handle, result.handle) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
  result: Changeset key(@type, source, isPartOf[*].creator[*].handle, isPartOf[*].handle, handle) {
    handle, url, name, description?, visibility
    author[]: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
    isPartOf[]: Repository key(@type, source, creator[*].handle, handle) {
      handle, url, name, description, tags[], visibility
      references[]: Entity key(url) { url }
      creator[]: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
    }
  }
}
```

## issues

```ts
PlanAction key(@type, source, object.isPartOf[*].creator[*].handle, object.isPartOf[*].handle, object.handle) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
  object: Task key(@type, source, isPartOf[*].creator[*].handle, isPartOf[*].handle, handle) {
    handle, url, name, description
    isPartOf[]: Repository key(@type, source, creator[*].handle, handle) {
      handle, url, name, description, tags[], visibility
      references[]: Entity key(url) { url }
      creator[]: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
    }
  }
}
```

## comments

```ts
RespondAction key(@type, source, result.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
  object: Changeset | Task key(@type, source, isPartOf[*].creator[*].handle, isPartOf[*].handle, handle) {
    handle, url, name, visibility?
    author[]?: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
    isPartOf[]: Repository key(@type, source, creator[*].handle, handle) {
      handle, url, name, description?, tags[]?, visibility
      references[]?: Entity key(url) { url }
      creator[]: Person | Organization key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
    }
  }
  result: Comment key(@type, source, sourceId) {
    sourceId, url, body, visibility
    author[]: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
    about[]: Changeset | Task key(@type, source, isPartOf[*].creator[*].handle, isPartOf[*].handle, handle) {
      handle
      isPartOf[]: Repository key(@type, source, creator[*].handle, handle) {
        handle, url, name, description?, tags[]?, visibility
        references[]?: Entity key(url) { url }
        creator[]: Person | Organization key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
      }
    }
  }
}
```

## commits

```ts
UpdateAction key(@type, source, result.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
  object: Repository key(@type, source, creator[*].handle, handle) {
    handle, url, name, description?, tags[]?, visibility
    references[]?: Entity key(url) { url }
    creator[]: Person | Organization key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
  }
  result: Revision key(@type, sourceId) {
    sourceId, url, name, description?
    author[]: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
    isPartOf[]: Repository | Changeset key(@type, source, creator[*].handle, handle) / key(@type, source, isPartOf[*].creator[*].handle, isPartOf[*].handle, handle) {
      handle, url?, name?, description?, tags[]?, visibility?
      references[]?: Entity key(url) { url }
      creator[]?: Person | Organization key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
      isPartOf[]?: Repository key(@type, source, creator[*].handle, handle) {
        handle, url, name, description?, tags[]?, visibility
        references[]?: Entity key(url) { url }
        creator[]: Person | Organization key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
      }
    }
    isBasedOn[]?: Revision key(@type, sourceId) { sourceId }
  }
}
```

## repositories

```ts
CreateAction key(@type, source, result.creator[*].handle, result.handle) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
  result: Repository key(@type, source, creator[*].handle, handle) {
    handle, url, name, visibility, description?, tags[]?
    creator[]: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
    isBasedOn[]?: Repository key(@type, source, creator[*].handle, handle) {
      handle, url, name, visibility
      creator[]: Organization key(@type, source, sourceId) { sourceId, handle, name, url }
    }
    references[]?: Entity key(url) { url }
  }
}
```

## replies

```ts
RespondAction key(@type, source, result.sourceId) {
  timestamp
  agent: Person | SoftwareAgent key(@type, source, sourceId) { sourceId, handle, name?, url }
  object: Changeset | Task key(@type, source, isPartOf[*].creator[*].handle, isPartOf[*].handle, handle) {
    handle, url, name, visibility?
    author[]?: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
    isPartOf[]: Repository key(@type, source, creator[*].handle, handle) {
      handle, url, name, description?, tags[]?, visibility
      references[]?: Entity key(url) { url }
      creator[]: Person | Organization key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
    }
  }
  result: Comment key(@type, source, sourceId) {
    sourceId, url, body, visibility
    author[]: Person | SoftwareAgent key(@type, source, sourceId) { sourceId, handle, name?, url }
    about[]: Changeset | Task key(@type, source, isPartOf[*].creator[*].handle, isPartOf[*].handle, handle) {
      handle
      isPartOf[]: Repository key(@type, source, creator[*].handle, handle) {
        handle, url, name, description?, tags[]?, visibility
        references[]?: Entity key(url) { url }
        creator[]: Person | Organization key(@type, source, sourceId) { sourceId, handle, name, sameAs[]?, url }
      }
    }
  }
}
```

## resolutions

```ts
AcceptAction | CompleteAction | CancelAction | RejectAction key(@type, source, sourceId) {
  sourceId, timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[]? }
  object: Changeset | Task key(@type, source, isPartOf[*].creator[*].handle, isPartOf[*].handle, handle) {
    handle, url, name, visibility?
    author[]?: Person key(@type, source, sourceId) { sourceId, handle, name?, sameAs[]?, url }
    isPartOf[]: Repository key(@type, source, creator[*].handle, handle) {
      handle, url, name, description, tags[], visibility
      references[]: Entity key(url) { url }
      creator[]: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
    }
  }
  result?: Revision key(@type, sourceId) { sourceId }
}
```

## stars

```ts
LikeAction key(@type, source, object.creator[*].handle, object.handle) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
  object: Repository key(@type, source, creator[*].handle, handle) {
    handle, url, name, visibility
    creator[]: Person | Organization key(@type, source, sourceId) { sourceId, handle, url, name? }
  }
}
```

## gists

```ts
PublishAction key(@type, source, result.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
  result: SoftwareSourceCode key(@type, source, sourceId) {
    sourceId, url, name, visibility*
    author[]: Person key(@type, source, sourceId) { sourceId, handle, name, sameAs[], url }
  }
}
```
