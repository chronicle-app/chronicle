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

If the source has IDs, use them in the key. In [completing a to-do](example:task-completed), the task, its project, its area, and its tag use this key:

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

A path can also follow a property backwards, by the name of its inverse. A session has no times of its own: the action whose :result it is gives them. In [a night of sleep](example:night-of-sleep), the :SleepSession's key reads them through `resultOf`, the inverse of :result:

```json
"@key": ["@type", "source", "resultOf.startTime", "resultOf.endTime", "resultOf.instrument[*].handle"]
```

A record under an action's :result is `resultOf` that action without saying so. Anywhere else, it gives `resultOf` itself. In [a stage of sleep](example:sleep-stage), the night is under the stage, so it gives its own action by its key alone, and its key reads the same times there as in its own record.

## An ID names one thing

A source ID is the :sourceId of one record. Many sources give an action no ID of its own, only an ID for the thing it acted on. Don't give the action that ID too, or two records will share it. Key the action through the thing instead. [Completing a to-do](example:task-completed) is keyed by the task it completed, its :object:

```json
"@key": ["@type", "source", "object.sourceId"]
```

An action that makes something, such as sending a message or publishing a post, has it as its :result and is keyed through it. In [a message from Alex](example:message-from-alex), the :Message has iMessage's ID, and the :MessageAction is keyed by the message:

```json
"@key": ["@type", "source", "result.sourceId"]
```

If an action can happen to the same thing more than once, its key also includes when it happened. [A favorite removed](example:favorite-removed) is keyed by the photo and the :timestamp.

A record inside an action can be keyed through the action, with the `action.` prefix. FoodNoms gives a food entry one ID, and it's the action's, so in [logging a meal](example:meal-logged) the :Meal is keyed by the action it was eaten in:

```json
"@key": ["@type", "source", "action.sourceId"]
```

A key starts with `@type`, unless the type is a guess that might change. FoodNoms doesn't say whether an entry is food or drink, so in [logging a drink](example:drink-logged) the action is keyed by its source and ID alone, and the entry keeps its identity if the guess changes.

## sameAs

:sameAs states that two references are the same entity.

The value can be another record. In [receiving a message with a photo](example:message-with-photo), the sender is identified by a handle in the `icloud` source, and :sameAs links them to the agent with the same address in the `email` source.

The value can also be text. `"@me"` marks a record as the owner of the archive. Plugins add it to your own accounts in each source.

Next: [Connecting records](03-connecting-records.md).
