# The shape of a record

Chronicle describes personal history as records: what happened, and the people and things involved. This guide walks through one record and the few ideas every other record shares.

## Actions and entities

Every record is one of two kinds.

- An :Action is something that happened at a point in time: running a command, sending a message, completing a to-do.
- An :Entity is a thing an action involves: a person, a message, a task, a machine.

History is mostly made of actions, and entities come along as their participants. A task enters the archive because you created it, edited it, or completed it; a person because they sent you a message.

Both kinds descend from :Base, which carries the fields every record needs to be identified: :source and :sourceId.

## A first record

Open [running a shell command](example:shell-command). It is a single :ExecuteAction with two records nested inside it:

1. `@type` names the class of the record: `ExecuteAction`.
2. `@key` lists the fields that identify it. The next guide covers keys.
3. `source` names where the record came from: the shell history.
4. `timestamp` is when the command ran, as reported by the source.
5. `agent` is who ran it: a :Person.
6. `object` is what the action was carried out on: the :Command that ran.

The nested records are records in their own right, each with its own type and identity. Nesting them keeps related records together; it does not turn them into labels.

## Actions connect the pieces

Most actions share the same few fields from :Action:

- :agent, the doer, when the source knows it. An action can be recorded without one.
- :object, the entity the action was carried out on.
- :instrument, the tool, application, or model used to do it.
- :timestamp, when it happened. This is when the action occurred, not when Chronicle read it.

More specific actions keep this shape. A :CompleteAction completes its :object; a :MessageAction sends its :object, a :Message.

## Values

Most fields hold other records. The rest hold plain values, with one of three datatypes:

- :Text, for names, identifiers, and content.
- :URL, an absolute address such as `https://example.com/page`.
- :DateTime, an instant in time. In TypeScript, a :DateTime is a `Date`; the examples show it as an ISO string.

## Reading the reference

Each [class](../classes/index.html) page lists the properties a record of that class can carry, including those it inherits. Each [property](../properties/index.html) page shows which classes use it, what values it expects, and whether it takes one value or many. Every page links to [examples](../examples/index.html) that use it, shown three ways:

- **Chronicle JSON** is what a plugin emits, with `@key` for identity.
- **JSON-LD** is the same record as linked data. `@key` becomes `doc:key`, because `@key` is not a JSON-LD keyword.
- **Turtle** is the RDF the example is written in.

Next: [Keys and sources](02-keys-and-sources.md).
