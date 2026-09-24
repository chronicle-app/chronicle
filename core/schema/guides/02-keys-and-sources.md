# Keys and sources

This guide covers the fields that say where a record came from and what identifies it: :source, :sourceId, `@key`, :handle, :inRealm, and :sameAs.

## Identity

A record carries `@type` and at least one of:

- `@key`, a list of the fields that identify it
- `@id`, an existing identity

Validation checks that every record, including nested ones, declares one of these. It does not check that the fields named in a key are present. This record has neither and is rejected:

```json
{ "@type": "Entity", "name": "Missing identity" }
```

## Source and source ID

:source is the system a record came from, such as `things-todo` or `imessage`. Identifiers in the record are scoped to it.

:sourceId is the identifier the source gave the record, such as a row ID, message GUID, or UUID. It only needs to be unique within its source.

If the source has IDs, use them in the key. In [completing a to-do](example:task-completed), every record uses this key:

```json
"@key": ["@type", "source", "sourceId"]
```

## Choosing a key

Use identifiers from the source rather than values you derive. In order of preference:

- **A source ID**, if the source has one.
- **A handle**, if the source identifies something by a username, address, or label. A :handle only means something in context: the username `sam` on one machine is a different account from `sam` on another.
- **The details of the event**, if there is nothing else. Shell history has no IDs, so [running a shell command](example:shell-command) keys the action by when it ran, the command, and the account that ran it.

Don't generate an identifier to pass validation. A generated ID is different each time the data is read, so the same record would get a new identity on every run.

## Keys with nested fields

A key field can be a path into a nested record. In [an assistant's reply](example:assistant-reply), the project is identified by its directory path, which is only unique on one machine, so its key includes the machine's handle through :inRealm:

```json
"@key": ["@type", "source", "handle", "inRealm.handle"]
```

A :Realm is a bounded domain, such as a computer or a workspace. Entities located in one use :inRealm, and agents that belong to one use :memberOf. The shell example keys the user account by its username and by `memberOf[*].handle`, the handle of each realm it belongs to.

## sameAs

:sameAs states that two references are the same entity.

The value can be another record. In [receiving a message with a photo](example:message-with-photo), the sender is identified by a handle in the `icloud` source, and :sameAs links them to the agent with the same address in the `email` source.

The value can also be text. `"@me"` marks a record as the owner of the archive. Plugins add it to your own accounts in each source.

Next: [Connecting records](03-connecting-records.md).
