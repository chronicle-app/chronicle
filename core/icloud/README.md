# @chronicle.app/icloud

Local macOS iCloud account and AddressBook lookup. Account lookup reads MobileMeAccounts with `plutil` and falls back to `defaults`; commands use argument arrays and never shell interpolation. No login/auth flow or network request is involved. Other platforms return no account.

`getICloudAccount()` selects the logged-in account, or the first account, and returns `null` when there is none.

`buildICloudPersonSchema(account?, options?)` returns the account owner as a schema `Person` tagged `sameAs: ['@me']`, keyed by the account's DSID (or email) with the email as `handle`. Omit `account` to look it up. It never returns `null`: when `account` is `null` or no account can be read (not macOS, not signed in, or unreadable preferences), it returns the per-source fallback:

```json
{ "@type": "Person", "source": "icloud", "@key": ["@type", "source"], "sameAs": ["@me"] }
```

The fallback has no identifier from iCloud, so it merges into the user only through `@me`.

Contact lookup lazily reads the local AddressBook and all account source databases through read-only `node:sqlite`. Lookups support case-insensitive email, normalized phone, and unambiguous name. Permission failures or unavailable databases leave enrichment absent; extraction can continue. Results are cached for the process lifetime.

`ContactCache([databasePaths])` and account lookup options support isolated fixtures. Tests do not access the host account or contacts. macOS database schemas and permissions can vary; live-device verification remains separate from fixture coverage.
