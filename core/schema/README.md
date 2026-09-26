# @chronicle.app/schema

A deliberately small extraction vocabulary with generated TypeScript interfaces
and Zod validators. The canonical file is [chronicle.ttl](chronicle.ttl); edit it and run
`npm run schema:generate` from the repository root to regenerate the TypeScript/Zod
schemas. `npm run schema:check` verifies that the committed output matches the
ontology without rewriting it.

## Documentation site

The schema is documented at https://schema.chronicle.app, built from
`chronicle.ttl` and the example records in [examples.ttl](examples.ttl). The
site lives in [apps/schema-site](../../apps/schema-site), which also describes
the examples format.

## Vocabulary

- `Base`: an identity-bearing node; carries `sourceId`.
- `Entity`: a thing described by a source; adds `name` and `url`.
- `Action`: an occurrence; adds a single entity-valued `object`.

Plugins extend these roots only where their outputs require it: Things adds task
lifecycle actions and collections/tags; shell adds commands, people, and machine
realms; iMessage adds messages and attachment media; Claude Code adds threads,
software agents, and model instruments; Safari adds page views; Arc Timeline adds
visits, trips, places, and journeys; WhatsApp adds group channels, members, and
quoted replies. Shared properties cover source identity,
event time, agents, membership, authors, and recipients.

`Text`, `URL`, `DateTime`, and `Number` are literal datatypes. Cardinality in
`chronicle.ttl` defines each property's constraints: `owl:minCardinality 1` makes
it required, and `owl:maxCardinality 1` makes it single-valued; otherwise it is a list. Records carry `@type` and at least one of `@key` (a nonempty list of
identity fields or computed key entries) or `@id` (an existing identity).
Identity validation checks that declaration, not the existence or hash of the
referenced fields. Source-specific extraction owns the values; never invent IDs
to make a record pass validation.

```js
import { ActionSchema, EntitySchema } from '@chronicle.app/schema';

// Synthetic example data.
const entity = EntitySchema.parse({
  '@type': 'Entity',
  '@key': ['sourceId'],
  sourceId: 'example-record-1',
  name: 'Example record',
  url: 'https://example.com/record/1',
});

const action = ActionSchema.parse({
  '@type': 'Action',
  '@key': ['sourceId'],
  sourceId: 'example-action-1',
  object: entity,
});
```

Each type has a `TypeSchema` validator and a `TypeAndChildrenSchema` validator
that also accepts its descendants. `BaseAndChildrenSchema` accepts all declared
record types. Validation checks nested identities, property types, URL syntax,
and cardinality. Unknown object fields are stripped by Zod; undeclared record
types are rejected. Import interfaces such as `Entity` and `Action` for static
typing; use validators at runtime to enforce identity requirements.

## Generation and compatibility

The generator turns N3/Turtle into TypeScript types and Zod validators. It handles
inheritance, domain/range, and OWL cardinality and fails for cyclic inheritance or
undeclared referenced classes. The package has no persistence metadata, derived
effects, or runtime filesystem parser.
Generated runtime code depends only on Zod; the TTL is also included in the package.

## Schema versions

The npm package follows Chronicle’s shared software version in `package.json`.
The ontology has an independent version declared with `owl:versionInfo` in
`chronicle.ttl`, exported as the generated `SCHEMA_VERSION` constant. Software
releases can advance without changing the vocabulary version.
`chronicle.ttl` is the only editable ontology; historical versions are preserved
by immutable software Git tags named `v<package-version>` and versioned npm packages.
Release notes map software versions to vocabulary versions.
The package exports `@chronicle.app/schema/chronicle.ttl`; the former
`@chronicle.app/schema/schema.ttl` export remains an alias for compatibility.

Use patch releases for description corrections that preserve meaning, minor
releases for compatible vocabulary additions, and major releases for removed
terms, changed meanings, or incompatible constraints. These compatibility rules
also apply during `0.x`. Keep term identifiers such as
`https://schema.chronicle.app/Task` stable; introduce a new term and deprecate the
old one when its concept changes fundamentally.

Snapshot paths use the vocabulary version, not the npm package version.
The publication convention is
`https://schema.chronicle.app/releases/<version>/chronicle.ttl`, with matching
documentation under the same release path. Published snapshots must never be
overwritten or removed by later deployments. The unversioned `/chronicle.ttl`
and term pages serve `main`, so `main` holds only vocabulary that is ready to
publish: work on new terms in a branch until it is ready. Any change to
`chronicle.ttl` after a release must raise `owl:versionInfo`;
`npm run schema:check` enforces this against the latest release tag. See [Preparing a release](../../RELEASING.md) for the
release procedure.

The vocabulary is intentionally small. Add terms only when a plugin needs them,
keeping existing term identifiers and meanings stable; regenerate and add
focused tests alongside each addition.

Node.js 22.13+. MIT covers the ontology, generator, generated code, and docs;
see [LICENSE](LICENSE).
