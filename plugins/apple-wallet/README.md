# @chronicle.app/apple-wallet

Card transactions from Apple Wallet on a Mac, with the time of each purchase to the second.

## Usage

```sh
chronicle extract apple-wallet
chronicle extract apple-wallet --since 2026-10-01
chronicle extract apple-wallet --input "/path/to/passes23.sqlite"
```

The store is `~/Library/Passes/passes23.sqlite`, opened read-only with built-in `node:sqlite`. A card's issuer sends each transaction on the card to Wallet soon after it happens, whether the card was used with Apple Pay, in person, or online, so the store holds purchases with the time to the second, which statements and exports don't give. The card's `pass.json` in `~/Library/Passes/Cards/` gives its name. Neither file needs Full Disk Access.

Transactions appear only once a card is added to Wallet on the Mac. Wallet keeps only the ten most recent on each card, and the oldest drops out as a new one arrives. The archive is what keeps history, and the time of day can't be recovered from any other source, so run this at least daily, and more often on a busy day. Not every issuer sends transactions.

Transactions come out newest first, and `--since` and `--until` bound when each happened.

## Schema

| Wallet thing            | Chronicle node         | Key                                                                           | Properties                                                                                                                                                                                |
| ----------------------- | ---------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A transaction           | `PayAction`            | `@type`, `source`, `sourceId` (Wallet's ID for the transaction)               | `agent` (you), `timestamp` (when it happened), `instrument` (the card), `result` (the transaction), `location` (a `Location` with its `latitude`, `longitude`, and `address`), when known |
| The transaction         | `FinancialTransaction` | `@type`, `source`, `sourceId` (the same ID)                                   | `amount` (a `MonetaryAmount` with its `value` and `currency`), `recipient` (the merchant), `hasPart` (the card account's entry)                                                           |
| The card account's side | `AccountEntry`         | `@type`, `source`, `sourceId` (the transaction's ID), `inAccount[*].sourceId` | `amount` (a `MonetaryAmount`, negative as a purchase on the card), `inAccount` (the account, by key)                                                                                      |
| The merchant            | `Agent`                | `source` (`apple-wallet`), `name`                                             | `name`, as the issuer sends it                                                                                                                                                            |
| The card                | `PaymentCard`          | `@type`, `source`, `sourceId` (the card network's ID for the card)            | `name` (as the issuer shows it), `alternateName` (its last digits), `category` (`credit`, `debit`, or `prepaid`), `inAccount` (the account)                                               |
| The account             | `FinancialAccount`     | `@type`, `source`, `sourceId` (the card's ID)                                 | `name` (the card's product), `accountType` (`liability` for a credit card, `asset` for a debit or prepaid card), `provider` (the issuer), `member` (you, by key)                          |
| The issuer              | `Organization`         | `@type`, `source` (`apple-wallet`), `name`                                    | `name`                                                                                                                                                                                    |
| You                     | `Person`               | `@type`, `source` (`icloud`), `sourceId` (your account's DSID)                | `handle` (your Apple Account email); `sameAs` `@me`                                                                                                                                       |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**A transaction is a payment you made, and the transaction holds the money.** Each one is a `PayAction` keyed by Wallet's ID for it (`identifier`), dated to the second. Its `result` is the `FinancialTransaction`, with the same ID, which carries the amount, as a `MonetaryAmount` with its value and currency, the merchant, and the card account's entry. The amount is always positive: the action says who paid and who was paid, so a refund, once Wallet's codes mark one, is a payment the other way. The issuer's own ID for the transaction (`service_identifier`) isn't emitted. An issuer can update a transaction after sending it, so each run is a snapshot: the amount is on the transaction, where it has a history, and every node is asserted complete as of the run.

**Amounts have four decimal places in the store.** Wallet stores `699300` for 69.93. Every amount seen so far ends in two zeros, as a two-decimal currency does with four places, and Wallet's own display shows the same amounts, which confirms it. Older descriptions of the iPhone's store say two places. `AMOUNT_SCALE` in the extractor is the one place it's set.

**Wallet's status and type codes aren't interpreted.** Every transaction seen so far has the same codes (`transaction_status` 1, `transaction_type` 0, `adjustment_type` 0) and is a completed purchase. Every row comes out as a payment, so a refund, a declined attempt, or a pending transaction isn't told apart yet. An authorization hold and the charge that follows it, such as an estimate at the time of an order and the final amount after delivery, arrive as two rows with different identifiers and amounts, and the hold is never retracted, so both come out as payments. Telling them apart is a matching step over the archive, since the store gives nothing to do it with. `--raw` shows the codes on each record.

**The merchant is an agent keyed by its name.** The issuer sends no merchant ID, only a billing descriptor, cleaned by Wallet when it can, with the raw name as the fallback. A descriptor can name a company, a branch, a payment processor, or a person, so the merchant is an `Agent` with its kind left open, keyed on its name without its type, the way Call History keys a bare phone number, so a source that knows the kind can refine it without splitting its identity. A name is kept as sent, so a chain's branches, which issuers often name with a store number, are separate agents. Wallet's own match of the merchant in Apple Maps and the merchant category code are left out until a transaction carries them.

**The card is the card as issued.** A card is a `PaymentCard` keyed by the card network's identifier for it (`primary_account_identifier`), which is the same on every device the card is added to, or by the pass's own ID when the network gives none. A card reissued with a new number is a new card. Its last digits (`primary_account_suffix`) are another name Wallet shows it by, its `alternateName`, which is what tells one card from another in a label. Its kind is its default payment application's type.

**The account is the card, as far as Wallet can tell.** Wallet has no number for the account a card draws on, so the `FinancialAccount` the card is `inAccount` is keyed like the card and named after the card's product. The card number's last digits stay on the card, since a reissue changes them while the account continues. A credit card owes, so its account is a `liability`; a debit or prepaid card holds, so its is an `asset`; a card with no `pass.json` has no kind. The issuer is the account's `provider`, from the pass's organization, and you are its `member`. Each transaction carries that account's side as one `AccountEntry` under `hasPart`, negative for a purchase whichever kind the account is. The merchant's side isn't known, so the transaction's entries don't sum to zero: that's the gap a ledger fills. A card reissued with a new number splits the account until a ledger names it, which is the documented cost of keying on the only identifier there is.

**A node that appears again carries only its identity.** You appear in full as the action's agent and by key alone as the account's `member`, and the account appears in full under the card and by key alone under the entry. The fold merges them by key, and the record stays small.

**Where, when Wallet knows.** An issuer's transaction carries no location. A transaction made with Apple Pay on the Mac can carry the device's fix and a locality, which become the action's `location`. A device without a fix records 0, 0, which is left out.

**The agent is your iCloud account,** whose Wallet this is, from `@chronicle.app/icloud`. It's omitted when no account can be read. An explicit `account` object (or null) describes a copied store without a host account lookup.

**Passes aren't read.** Boarding passes, tickets, and the other passes in the same store are left for a record type of their own.

## Tests

The tests build a synthetic `passes23.sqlite`, with a `Cards` folder beside it, with `node:sqlite`, and pass an explicit iCloud account. They never read the host's Wallet or Apple Account.
