# @chronicle.app/imessage

Read `chat.db` with `ImessageExtractor`, then emit MessageAction/Message records with `ImessageTransformer`. `input` defaults to the macOS Messages database; use a consistent backup for exported data. The connection is read-only via built-in `node:sqlite`. Date windows are exclusive, records newest-first, and `limit: 0` means unlimited.

Automatic iCloud account and AddressBook enrichment comes from `@chronicle.app/icloud`. `includeContactNames: false` skips contacts. An explicit `account` object (or null) lets callers describe exported data without host account lookup. Transformer config can inject `lookupContact` for exported contacts. Missing permissions/account/contact data fall back to source-local identity and unlabelled participants. When no identifier for the account owner is available, the owner is left out of the agent and recipients.

Attachments are local file references with MIME metadata, not copied bytes. Missing files are skipped. Attributed-body decoding retains the existing heuristic; it is not a complete typedstream decoder. Raw records preserve the source blob, and large integer timestamps are decimal strings so serialization is safe.

Tests use synthetic Messages and AddressBook databases, account command fixtures, and temporary attachment files. They do not read personal messages or contacts.
