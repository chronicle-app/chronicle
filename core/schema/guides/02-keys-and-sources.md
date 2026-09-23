# Keys and sources

Every record says where it came from and what identifies it. This guide covers the fields that do that: :source, :sourceId, `@key`, :handle, :inRealm, and :sameAs.

## Every record has an identity

A record carries `@type` and at least one of:

- `@key`: a list of the fields that identify it, or
- `@id`: an identity the record already has.

Validation checks that one of these is declared on every record, nested ones included. It does not check that the fields a key names are present. A record with neither is rejected:

```json
{ "@type": "Entity", "name": "Missing identity" }
```

## Sources and their IDs

:source names the system a record came from, such as `things-todo` or `imessage`. It is also the namespace for the record's identifiers.

:sourceId is the identifier that system gave the record: a row ID, a message GUID, a UUID. It only has to be unique within its source, because it is always read together with the source. Two apps can both have a record `42` without being confused.

When the source gives each record an ID, key on it. In [completing a to-do](example:task-completed), every record uses the same key:

```json
"@key": ["@type", "source", "sourceId"]
```

## Choosing a key

Prefer identifiers the source provides over anything you derive:

- **A source ID**, when there is one. It is the most reliable identity.
- **A handle**, when the source knows something by a username, address, or label rather than an ID. :handle is contextual: `sam` means one account on one machine and another somewhere else.
- **The facts of the event**, when there is nothing else. Shell history has no IDs, so [running a shell command](example:shell-command) keys the action by when it ran, what ran, and who ran it.

Never invent an identifier to make a record pass validation. A generated ID changes every time the data is read, so the same record would get a new identity each time.

## Keys can reach into nested records

A key field can be a path into a nested record. In [an assistant's reply](example:assistant-reply), the project is a directory path, which is only unique on one machine. Its key includes the machine's handle through :inRealm:

```json
"@key": ["@type", "source", "handle", "inRealm.handle"]
```

A :Realm is a bounded domain, such as a computer or a workspace. Use :inRealm for entities that live inside one, and :memberOf for agents that belong to one. The shell example keys its user account by username and by the handle of each realm it is a member of: `memberOf[*].handle`.

## The same thing, seen twice

Different sources often know the same person or thing. :sameAs says that two references are the same entity. It asserts identity, not similarity or association.

A :sameAs value can be another record. In [receiving a message with a photo](example:message-with-photo), the sender is known to the messaging service by an address, and :sameAs links the same person as the email source knows them.

A :sameAs value can also be a textual identity reference. `"@me"` marks a record as you, the owner of the archive. Plugins attach it to your own accounts, so your identities in every source refer to the same person.

Next: [Connecting records](03-connecting-records.md).
