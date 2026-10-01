# GitHub shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## pull-requests

```ts
PublishAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
  object: PullRequest key(sourceId) {
    sourceId, url, name, body?, datePublished, visibility
    author[]: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
    isPartOf[]: Repository key(creator.sourceId, name) {
      url, name, description, tags[], visibility
      references[]: Entity key(url, any source) { url }
      creator[]: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
    }
  }
}
```

## issues

```ts
PublishAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
  object: Issue key(sourceId) {
    sourceId, url, name, body, datePublished, visibility
    author[]: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
    isPartOf[]: Repository key(creator.sourceId, name) {
      url, name, description, tags[], visibility
      references[]: Entity key(url, any source) { url }
      creator[]: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
    }
  }
}
```

## comments

```ts
RespondAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
  object: PullRequest | Issue key(sourceId) {
    sourceId, url, name, datePublished, visibility
    author[]: Person key(sourceId) { sourceId, handle, name?, sameAs[]?, url }
    isPartOf[]: Repository key(creator.sourceId, name) {
      url, name, description?, tags[]?, visibility
      references[]?: Entity key(url, any source) { url }
      creator[]: Person | Organization key(sourceId) { sourceId, handle, name, sameAs[]?, url }
    }
  }
  result: Comment key(sourceId) {
    sourceId, url, body, visibility
    author[]: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
    about[]: PullRequest | Issue key(sourceId) { sourceId }
  }
}
```

## reviews

```ts
RespondAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
  object: PullRequest key(sourceId) {
    sourceId, url, name, datePublished, visibility
    author[]: Person key(sourceId) { sourceId, handle, name, sameAs[]?, url }
    isPartOf[]: Repository key(creator.sourceId, name) {
      url, name, description?, tags[]?, visibility
      references[]?: Entity key(url, any source) { url }
      creator[]: Person | Organization key(sourceId) { sourceId, handle, name, sameAs[]?, url }
    }
  }
  result: Comment | Response key(sourceId) {
    sourceId, url, body, visibility, ratingValue?
    author[]: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
    about[]: PullRequest key(sourceId) { sourceId }
    isPartOf[]?: Response key(sourceId) { sourceId }
    inReplyTo[]?: Comment key(sourceId) { sourceId }
  }
}
```

## replies

```ts
RespondAction key(sourceId) {
  sourceId, timestamp
  agent: Person | SoftwareAgent key(sourceId) { sourceId, handle, name?, url }
  object: PullRequest | Issue key(sourceId) {
    sourceId, url, name, datePublished, visibility
    author[]: Person key(sourceId) { sourceId, handle, name?, sameAs[]?, url }
    isPartOf[]: Repository key(creator.sourceId, name) {
      url, name, description?, tags[]?, visibility
      references[]?: Entity key(url, any source) { url }
      creator[]: Person | Organization key(sourceId) { sourceId, handle, name, sameAs[]?, url }
    }
  }
  result: Response | Comment key(sourceId) {
    sourceId, url, body, ratingValue?, visibility
    author[]: Person | SoftwareAgent key(sourceId) { sourceId, handle, name?, url }
    about[]: PullRequest | Issue key(sourceId) { sourceId }
    isPartOf[]?: Response key(sourceId) { sourceId }
    inReplyTo[]?: Comment key(sourceId) { sourceId }
  }
}
```

## stars

```ts
LikeAction key(object.creator.sourceId, object.name) {
  timestamp
  agent: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
  object: Repository key(creator.sourceId, name) {
    url, name, visibility
    creator[]: Person | Organization key(sourceId) { sourceId, handle, url, name? }
  }
}
```

## gists

```ts
PublishAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
  object: SoftwareSourceCode key(sourceId) {
    sourceId, url, name, datePublished, visibility*
    author[]: Person key(sourceId) { sourceId, handle, name, sameAs[], url }
  }
}
```
