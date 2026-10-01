# GitHub shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each line is a node: its type, its key in parentheses (after `@type` and
`source`), and its properties. `?` marks a property that is sometimes
absent, `[]` a list, and `*` a value computed in the transformer rather
than copied or converted from the record. Every node also has `source`.

## pull-requests

```text
PublishAction (sourceId): sourceId, timestamp
  agent → Person (sourceId): sourceId, handle, name, sameAs[], url
  object → PullRequest (sourceId): sourceId, url, name, body?, datePublished, visibility
    author[] → Person (sourceId): sourceId, handle, name, sameAs[], url
    isPartOf[] → Repository (creator.sourceId + name): url, name, description, tags[], visibility
      references[] → Entity (url, any source): url
      creator[] → Person (sourceId): sourceId, handle, name, sameAs[], url
```

## issues

```text
PublishAction (sourceId): sourceId, timestamp
  agent → Person (sourceId): sourceId, handle, name, sameAs[], url
  object → Issue (sourceId): sourceId, url, name, body, datePublished, visibility
    author[] → Person (sourceId): sourceId, handle, name, sameAs[], url
    isPartOf[] → Repository (creator.sourceId + name): url, name, description, tags[], visibility
      references[] → Entity (url, any source): url
      creator[] → Person (sourceId): sourceId, handle, name, sameAs[], url
```

## comments

```text
RespondAction (sourceId): sourceId, timestamp
  agent → Person (sourceId): sourceId, handle, name, sameAs[], url
  object → PullRequest | Issue (sourceId): sourceId, url, name, datePublished, visibility
    author[] → Person (sourceId): sourceId, handle, name?, sameAs[]?, url
    isPartOf[] → Repository (creator.sourceId + name): url, name, description?, tags[]?, visibility
      references[]? → Entity (url, any source): url
      creator[] → Person | Organization (sourceId): sourceId, handle, name, sameAs[]?, url
  result → Comment (sourceId): sourceId, url, body, visibility
    author[] → Person (sourceId): sourceId, handle, name, sameAs[], url
    about[] → PullRequest | Issue (sourceId): sourceId
```

## reviews

```text
RespondAction (sourceId): sourceId, timestamp
  agent → Person (sourceId): sourceId, handle, name, sameAs[], url
  object → PullRequest (sourceId): sourceId, url, name, datePublished, visibility
    author[] → Person (sourceId): sourceId, handle, name, sameAs[]?, url
    isPartOf[] → Repository (creator.sourceId + name): url, name, description?, tags[]?, visibility
      references[]? → Entity (url, any source): url
      creator[] → Person | Organization (sourceId): sourceId, handle, name, sameAs[]?, url
  result → Comment | Response (sourceId): sourceId, url, body, visibility, ratingValue?
    author[] → Person (sourceId): sourceId, handle, name, sameAs[], url
    about[] → PullRequest (sourceId): sourceId
    isPartOf[]? → Response (sourceId): sourceId
    inReplyTo[]? → Comment (sourceId): sourceId
```

## replies

```text
RespondAction (sourceId): sourceId, timestamp
  agent → Person | SoftwareAgent (sourceId): sourceId, handle, name?, url
  object → PullRequest | Issue (sourceId): sourceId, url, name, datePublished, visibility
    author[] → Person (sourceId): sourceId, handle, name?, sameAs[]?, url
    isPartOf[] → Repository (creator.sourceId + name): url, name, description?, tags[]?, visibility
      references[]? → Entity (url, any source): url
      creator[] → Person | Organization (sourceId): sourceId, handle, name, sameAs[]?, url
  result → Response | Comment (sourceId): sourceId, url, body, ratingValue?, visibility
    author[] → Person | SoftwareAgent (sourceId): sourceId, handle, name?, url
    about[] → PullRequest | Issue (sourceId): sourceId
    isPartOf[]? → Response (sourceId): sourceId
    inReplyTo[]? → Comment (sourceId): sourceId
```

## stars

```text
LikeAction (object.creator.sourceId + object.name): timestamp
  agent → Person (sourceId): sourceId, handle, name, sameAs[], url
  object → Repository (creator.sourceId + name): url, name, visibility
    creator[] → Person | Organization (sourceId): sourceId, handle, url, name?
```

## gists

```text
PublishAction (sourceId): sourceId, timestamp
  agent → Person (sourceId): sourceId, handle, name, sameAs[], url
  object → SoftwareSourceCode (sourceId): sourceId, url, name, datePublished, visibility*
    author[] → Person (sourceId): sourceId, handle, name, sameAs[], url
```
