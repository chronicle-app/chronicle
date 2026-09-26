# @chronicle.app/icloud

Local macOS iCloud account and AddressBook lookup. Account lookup reads MobileMeAccounts with `plutil` and falls back to `defaults`. Newer macOS versions leave those preferences empty, so it then reads the Apple Account from the system Accounts database (`~/Library/Accounts/Accounts4.sqlite`) with read-only `node:sqlite`, decoding its keyed-archive properties with `plutil`. Commands use argument arrays and never shell interpolation. No login/auth flow or network request is involved. Other platforms return no account.

`getICloudAccount()` selects the logged-in account, or the first account, and returns `null` when there is none.

`buildICloudPersonSchema(account?, options?)` returns the account owner as a schema `Person` tagged `sameAs: ['@me']`, keyed by the account's DSID (or email) with the email as `handle`. Omit `account` to look it up. It returns `null` when `account` is `null` or no account can be read (not macOS, no Apple Account signed in, or unreadable account data): with no iCloud identifier there is nothing to key the owner on, so callers omit them rather than emit a Person every owner would share.

Contact lookup lazily reads the local AddressBook and all account source databases through read-only `node:sqlite`. Lookups support case-insensitive email, normalized phone, and unambiguous name. Permission failures or unavailable databases leave enrichment absent; extraction can continue. Results are cached for the process lifetime.

`ContactCache([databasePaths])` and account lookup options support isolated fixtures. Tests do not access the host account or contacts. macOS database schemas and permissions can vary; live-device verification remains separate from fixture coverage.
