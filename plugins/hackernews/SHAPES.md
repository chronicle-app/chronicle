# Hacker News shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each line is a node: its type, its key in parentheses (after `@type` and
`source`), and its properties. `?` marks a property that is sometimes
absent, `[]` a list, and `*` a value computed in the transformer rather
than copied or converted from the record. Every node also has `source`.

## submissions

```text
PublishAction (sourceId): sourceId, timestamp
  agent → Agent (handle): handle, sameAs[], url, description
  object → Post (sourceId): sourceId, url, name, body?*
    author[] → Agent (handle): handle, sameAs[], url, description
    references[]? → Entity (url, any source): url
```

## comments

```text
RespondAction (sourceId): sourceId, timestamp
  agent → Agent (handle): handle, sameAs[], url, description
  object → Comment | Post (sourceId): sourceId, url, body?, name?
    author[] → Agent (handle): handle, url, sameAs[]?, description?
    about[]? → Post (sourceId): sourceId, url, name
      author[] → Agent (handle): handle, sameAs[], url, description
      references[] → Entity (url, any source): url
    references[]? → Entity (url, any source): url
  result → Comment (sourceId): sourceId, url, body*
    author[] → Agent (handle): handle, sameAs[], url, description
    about[] → Post (sourceId): sourceId, url, name
      author[] → Agent (handle): handle, sameAs[]?, url, description?
      references[] → Entity (url, any source): url
```

## replies

```text
RespondAction (sourceId): sourceId, timestamp
  agent → Agent (handle): handle, url
  object → Comment | Post (sourceId): sourceId, url, body?, name?
    author[] → Agent (handle): handle, sameAs[], url, description
    about[]? → Post (sourceId): sourceId, url, name
      author[] → Agent (handle): handle, url
      references[] → Entity (url, any source): url
    references[]? → Entity (url, any source): url
  result → Comment (sourceId): sourceId, url, body*
    author[] → Agent (handle): handle, url
    about[] → Post (sourceId): sourceId, url, name
      author[] → Agent (handle): handle, url, sameAs[]?, description?
      references[] → Entity (url, any source): url
```
