# Apple Wallet shapes

What each record type becomes, from the transformer’s output for the test
fixtures. Generated: run `npm run shapes` in this plugin to update it.

Each node is its type, its key, and its properties in braces; a property
that links to another node names that node’s type. `key(…)` lists the key
fields after `@type` and `source`, and says `any source` when the key has
no `source`. `?` marks a property that is sometimes absent, `[]` a list,
and `*` a value computed in the transformer rather than copied or
converted from the record. Every node also has `source`.

## transactions

```ts
PayAction key(sourceId) {
  sourceId, timestamp
  agent: Person key(sourceId) { sourceId, handle, sameAs[] }
  instrument[]?: PaymentCard key(sourceId) {
    sourceId, name?, alternateName[], category[]?
    inAccount[]: FinancialAccount key(sourceId) {
      sourceId, name?, alternateName[], accountType?*
      provider: Organization key(name) { name }
      member[]: Person key(sourceId) { sourceId }
    }
  }
  result: FinancialTransaction key(sourceId) {
    sourceId
    amount: MonetaryAmount { value, currency? }
    recipient[]?: Agent key(name) { name }
    hasPart[]?: AccountEntry key(sourceId, inAccount[*].sourceId) {
      sourceId
      amount: MonetaryAmount { value*, currency }
      inAccount[]: FinancialAccount key(sourceId) { sourceId }
    }
  }
  location?: Location { latitude, longitude, address }
}
```
