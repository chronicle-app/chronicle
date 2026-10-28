# Apple Wallet shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the
fields of the node’s key, `@type` and `source` too, so a key without one
shows it. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## transactions

```ts
PayAction key(@type, source, result.sourceId) {
  timestamp
  agent: Person key(@type, source, sourceId) { sourceId, handle, sameAs[] }
  instrument[]?: PaymentCard key(@type, source, sourceId) {
    sourceId, name?, alternateName[], category[]?
    inAccount[]: FinancialAccount key(@type, source, sourceId) / key(@type, source, action.instrument[*].sourceId) { sourceId?, name, financialAccountType?* }
  }
  result: FinancialTransaction key(@type, source, sourceId) {
    sourceId
    amount: MonetaryAmount { value, currency? }
    recipient[]?: Agent key(source, name) { name }
    hasPart[]?: FinancialPosting key(@type, source, action.result.sourceId, inAccount[*].sourceId) {
      amount: MonetaryAmount { value*, currency }
      inAccount[]: FinancialAccount key(@type, source, sourceId) / key(@type, source, action.instrument[*].sourceId) { sourceId? }
    }
  }
  location?: Location { latitude, longitude, address }
}
```
