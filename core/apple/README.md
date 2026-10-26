# @chronicle.app/apple

Apple data on a Mac, for plugins that read Apple apps: the Apple Account signed in, AddressBook contacts, binary property lists, and Messages' group chats. It was `@chronicle.app/icloud` before 0.5.0.

Account lookup reads MobileMeAccounts with `plutil` and falls back to `defaults`. Newer macOS versions leave those preferences empty, so it then reads the Apple Account from the system Accounts database (`~/Library/Accounts/Accounts4.sqlite`) with read-only `node:sqlite`, decoding its keyed-archive properties with `plutil`. Commands use argument arrays and never shell interpolation. No login/auth flow or network request is involved. Other platforms return no account.

`getICloudAccount()` selects the logged-in account, or the first account, and returns `null` when there is none.

`buildICloudPersonSchema(account?, options?)` returns the account owner as a schema `Person` tagged `sameAs: ['@me']`, keyed by the account's DSID (or email) with the email as `handle`. Omit `account` to look it up. It returns `null` when `account` is `null` or no account can be read (not macOS, no Apple Account signed in, or unreadable account data): with no iCloud identifier there is nothing to key the owner on, so callers omit them rather than emit a Person every owner would share.

Contact lookup lazily reads the local AddressBook and all account source databases through read-only `node:sqlite`. Lookups support case-insensitive email, normalized phone, and unambiguous name. Permission failures or unavailable databases leave enrichment absent; extraction can continue. Results are cached for the process lifetime.

`ContactCache([databasePaths])` and account lookup options support isolated fixtures. Tests do not access the host account or contacts. macOS database schemas and permissions can vary; live-device verification remains separate from fixture coverage.

`parseBinaryPlist(bytes)` reads a binary property list (`bplist00`): arrays, sets, dictionaries, strings, numbers, dates, data, and `Uid` references into an NSKeyedArchiver archive's `$objects`, which it leaves for the caller to follow. Apple apps store preferences this way, and Core Data stores transformable attributes and CloudKit records this way.

`groupChatChannel({ groupId, originalGroupId })` returns a Messages group chat as a `Channel` in the `imessage` namespace, so every plugin that sees one keys it the same way. Messages' `chat` table keeps two IDs for a group: `original_group_id`, the one it started with, and `group_id`, which Messages sometimes replaces. The Channel is keyed by `original_group_id`, or `group_id` when there's none, and is `sameAs` `group_id` when the two differ, so a record of either ID lands on it. A chat's `chat_identifier` isn't used: each device keeps its own. `GROUP_CHAT_STYLE` is a group chat's `chat.style`.
