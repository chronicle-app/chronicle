# Twitter shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## tweets

```ts
PublishAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[] }
  instrument[]?: SoftwareApplication key(@type, source, name) { name*, url* }
  result: Post key(@type, source, sourceId) {
    sourceId, url, body
    author[]: Agent key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[] }
    references[]?: Agent | Entity | Post key(@type, source, sourceId) / key(@type, url) / key(@type, source, handle) { sourceId?*, handle?*, name?, url* }
    about[]?: Tag key(@type, source, handle) { handle }
    contains[]?: ImageObject key(@type, source, sourceId) { url, contentPath, mimeType, sourceId }
    inReplyTo[]?: Post key(@type, source, sourceId) {
      sourceId, url
      author[]: Agent key(@type, source, sourceId) { sourceId, handle, url }
    }
  }
  location?: Location { latitude, longitude }
}
// Some records also become:
DeleteAction key(@type, source, object.sourceId) {
  timestamp
  agent: Agent key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[] }
  object: Post key(@type, source, sourceId) { sourceId }
}
```

## likes

```ts
LikeAction key(@type, source, object.sourceId, agent.sourceId) {
  timestamp?
  agent: Agent key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[] }
  object: Post key(@type, source, sourceId) {
    sourceId, body, url?
    author[]?: Agent key(@type, source, sourceId) { sourceId, handle, url, name }
  }
}
```

## group-direct-messages

```ts
MessageAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, sourceId) { sourceId }
  result: Message key(@type, source, sourceId) {
    sourceId, body
    recipient[]: Agent key(@type, source, sourceId) { sourceId }
    author[]: Agent key(@type, source, sourceId) { sourceId }
    isPartOf[]: Thread key(@type, source, sourceId) { sourceId, name }
  }
}
```

## direct-messages

```ts
MessageAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, sourceId) { sourceId }
  result: Message key(@type, source, sourceId) {
    sourceId, body
    recipient[]: Agent key(@type, source, sourceId) { sourceId }
    author[]: Agent key(@type, source, sourceId) { sourceId }
    isPartOf[]: Thread key(@type, source, sourceId) { sourceId }
    references[]: Entity | Post key(@type, url) / key(@type, source, sourceId) { url*, sourceId?* }
    contains[]: ImageObject key(@type, url) { url, contentPath, mimeType }
  }
}
// Every record also becomes:
RespondAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, sourceId) { sourceId }
  object: Message key(@type, source, sourceId) { sourceId }
  result: Response key(@type, source, sourceId) { sourceId, body }
}
```

## profile

```ts
UpdateAction key(@type, source, object.sourceId, timestamp) {
  timestamp*
  agent: Agent key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[] }
  object: Agent key(@type, source, sourceId) {
    sourceId, handle, name, url, sameAs[], description*
    location: Location { address }
    emblem: ImageObject key(url) { url, contentPath, mimeType }
  }
}
```

## followers

```ts
FollowAction key(@type, source, agent.sourceId, object.sourceId) {
  agent: Agent key(@type, source, sourceId) { sourceId }
  object: Agent key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[] }
}
```

## following

```ts
FollowAction key(@type, source, agent.sourceId, object.sourceId) {
  agent: Agent key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[] }
  object: Agent key(@type, source, sourceId) { sourceId }
}
```

## grok-chats

```ts
MessageAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent | SoftwareAgent key(@type, source, sourceId) / key(@type, source, handle) { sourceId?, handle, name*, url?, sameAs[]? }
  result: Message key(@type, source, sourceId) {
    sourceId, body
    author[]: Agent | SoftwareAgent key(@type, source, sourceId) / key(@type, source, handle) { sourceId?, handle, name*, url?, sameAs[]? }
    isPartOf[]: Thread key(@type, source, sourceId) { sourceId }
    references[]?: Post key(@type, source, sourceId) { sourceId }
  }
}
```

## bookmarks

```ts
BookmarkAction key(@type, source, object.sourceId, agent.sourceId) {
  timestamp
  agent: Agent key(@type, source, sourceId) { sourceId, handle, name, url, sameAs[] }
  object: Post key(@type, source, sourceId) {
    sourceId, url, body
    author[]: Agent key(@type, source, sourceId) { sourceId, handle, url, name }
  }
}
```

## mentions

```ts
PublishAction key(@type, source, result.sourceId) {
  timestamp
  agent: Agent key(@type, source, sourceId) { sourceId, handle, url, name }
  result: Post key(@type, source, sourceId) {
    sourceId, url, body
    author[]: Agent key(@type, source, sourceId) { sourceId, handle, url, name }
    references[]: Agent key(@type, source, sourceId) { sourceId, handle, url }
  }
}
```
