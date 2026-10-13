---
'@chronicle.app/apple-wallet': minor
'@chronicle.app/schema': minor
'@chronicle.app/etl': patch
---

Add the Apple Wallet plugin, run as `chronicle extract apple-wallet`. It extracts the card transactions in Wallet on a Mac, which a card's issuer sends soon after each purchase, with the time to the second, whether the card was used with Apple Pay, in person, or online. Each transaction is a `PayAction` keyed by Wallet's ID for it, with you as its `agent` and the card as its `instrument`. Its `result` is the `Payment`, which carries the `amount`, the `currency`, and the merchant as its `recipient`, an `Organization` keyed by the name the issuer sends. The card is a `PaymentCard` keyed by the card network's identifier for its account, named as its issuer shows it, with its kind as its `category` and the issuer as its `issuedBy`. Where the transaction happened is its `location` when Wallet knows. Each run is a snapshot, since a pending transaction's amount can change when it posts.

The vocabulary adds `TradeAction` and its kind `PayAction`, the `Payment` that a payment produces with its `amount` and `currency`, and the `PaymentCard` that payments draw on with its `issuedBy`. `recipient` applies to a `Payment`.

A plugin's `SHAPES.md` leaves out `@asserts`, the completeness marker a snapshot source puts on every node, as it already leaves out `@assertedAt`.
