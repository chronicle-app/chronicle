# @chronicle.app/icloud

Local macOS iCloud account and AddressBook lookup, extracted from the internal helper package. Account lookup reads MobileMeAccounts with `plutil` and falls back to `defaults`; commands use argument arrays and never shell interpolation. No login/auth flow or network request is involved. Other platforms return no account.

`getICloudAccount()` selects the logged-in account, or the first account. `buildICloudPersonSchema()` emits a source-keyed Person with the existing `@me` marker, including a source-local fallback when unavailable.

Contact lookup lazily reads the local AddressBook and all account source databases through read-only `node:sqlite`. Lookups support case-insensitive email, normalized phone, and unambiguous name. Permission failures or unavailable databases leave enrichment absent; extraction can continue. Results are cached for the process lifetime.

`ContactCache([databasePaths])` and account lookup options support isolated fixtures. Tests do not access the host account or contacts. macOS database schemas and permissions can vary; live-device verification remains separate from fixture coverage.
