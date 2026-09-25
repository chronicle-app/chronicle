# @chronicle.app/things-todo

Read Things 3 tasks/projects with `ThingsTodoExtractor`, then map task lifecycle events with `ThingsTodoTransformer`. The default path locates the installed Things database; pass `input` to use a consistent backup or fixture. The task owner is a source-local `Agent` tagged `@me`, named after the OS account's full name (`id -F` on macOS); set `agentName` to use another name. The name is a label only: the owner is keyed by `['@type', 'source']` and gets no invented identifiers. Elsewhere, or when the account has no full name, the owner has no name.

Uses read-only `node:sqlite`. `since`/`until` are inclusive modification-date bounds; `limit: 0` is unlimited. Records are newest-modified first. Raw project/heading records enrich task relationships; the transformer emits task actions (plan, update, complete, cancel, delete), not standalone project actions. Source timestamps remain event timestamps; no store annotations are generated.

Use the ETL Runner or call setup/extract/teardown directly, always tearing down in a finally block. This package has no CLI dependency. The tests build synthetic Things tables without accessing an installed application.
