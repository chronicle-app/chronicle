# The shape of a record

This guide explains how a Chronicle record is structured, using one example record.

## Actions and entities

Every record is either an action or an entity.

- An :Action is something that happened at a point in time, such as running a command, sending a message, or completing a to-do.
- An :Entity is a thing an action involves, such as a person, a message, a task, or a machine.

Most entities are recorded as part of an action. A task is recorded when you create, edit, or complete it, and a person when they send you a message.

Both descend from :Base, which declares :source and :sourceId.

## Actions over time

Each action happens at a time and links to the entities it involves. Actions from different sources often involve the same entities, so across many actions the entities and their links form a graph.

![Four actions on a timeline, linked to the entities they involve](diagrams/timeline.svg 'Four actions from four sources. Solid lines are fields of the action, such as :agent and :object; dashed lines link one entity to another. The shell history and the to-do app each have their own record of you, and both are marked with :sameAs "@me", so they are the same node.')

## An example record

Open [running a shell command](example:shell-command). It is an :ExecuteAction with two nested records:

1. `@type` is the record's class, `ExecuteAction`.
2. `@key` lists the fields that identify the record. The next guide covers keys.
3. `source` is where the record came from, here the shell history.
4. `timestamp` is when the command ran, as reported by the source.
5. `agent` is who ran it, a :Person.
6. `object` is the :Command that ran.

Each nested record has its own type and identity, the same as a top-level record.

## Common action fields

Most actions use these fields from :Action:

- :agent is who did it, if the source knows. An action can have no agent.
- :object is the entity the action was carried out on.
- :instrument is the tool, application, or model that was used.
- :timestamp is when the action happened, not when Chronicle read it.

More specific actions use the same fields. A :CompleteAction completes its :object, and a :MessageAction sends its :object, a :Message.

## Values

A field holds either another record or a plain value. Plain values have one of three datatypes:

- :Text for names, identifiers, and content.
- :URL for an absolute address, such as `https://example.com/page`.
- :DateTime for an instant in time. In TypeScript it is a `Date`; the examples show it as an ISO string.

## Using the reference

A [class](../classes/index.html) page lists the properties a record of that class can have, including inherited ones. A [property](../properties/index.html) page lists the classes that use it, the values it accepts, and whether it takes one value or a list. Both link to [examples](../examples/index.html), which are shown in three formats:

- **Chronicle JSON** is what a plugin emits, with `@key` for identity.
- **JSON-LD** is the same record as linked data. `@key` is written as `doc:key`, because `@key` is not a JSON-LD keyword.
- **Turtle** is the RDF source of the example.

Next: [Keys and sources](02-keys-and-sources.md).
