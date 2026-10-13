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
    sourceId, name?, lastDigits, category[]?
    issuedBy: Organization key(name) { name }
    holder: Person key(sourceId) { sourceId, handle, sameAs[] }
    account: FinancialAccount key(sourceId) {
      sourceId, name?, lastDigits, accountType?
      provider: Organization key(name) { name }
      holder: Person key(sourceId) { sourceId, handle, sameAs[] }
    }
  }
  result: Transaction key(sourceId) {
    sourceId, amount, currency?
    recipient[]?: Organization key(name) { name }
    posting[]?: Posting key(sourceId, account.sourceId) {
      sourceId, amount*, currency
      account: FinancialAccount key(sourceId) {
        sourceId, name?, lastDigits, accountType?
        provider: Organization key(name) { name }
        holder: Person key(sourceId) { sourceId, handle, sameAs[] }
      }
    }
  }
  location?: Location { latitude, longitude, address }
}
```
