# @chronicle.app/schema

A deliberately small extraction vocabulary with generated TypeScript interfaces
and Zod validators. The canonical file is [chronicle.ttl](chronicle.ttl); edit it and run
`npm run schema:generate` from the repository root. This generates both the
TypeScript/Zod schemas and [the HTML reference](docs/schema.html).
`npm run schema:check` verifies that both committed outputs match the ontology
without rewriting them.

Open `docs/schema.html` directly in a browser; its styles are embedded and it
requires no server or network access. It includes hierarchy navigation, linked
`:term` references, inherited properties, ranges, cardinality, and term URIs.
Use `npm run generate:docs -w @chronicle.app/schema` to regenerate just the HTML.
The package also exports the page as `@chronicle.app/schema/schema.html`.

## Vocabulary

- `Base`: an identity-bearing node; carries `sourceId`.
- `Entity`: a thing described by a source; adds `name` and `url`.
- `Action`: an occurrence; adds a single entity-valued `object`.

Plugins extend these roots only where their outputs require it: Things adds task
lifecycle actions and collections/tags; shell adds commands, people, and machine
realms; iMessage adds messages and attachment media; Claude Code adds threads,
software agents, and model instruments. Shared properties cover source identity,
event time, agents, membership, authors, and recipients.

`Text`, `URL`, and `DateTime` are literal datatypes. Properties remain optional;
`chronicle.ttl` defines whether each is single-valued or a list. Records carry `@type` and at least one of `@key` (a nonempty list of
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

The generator is adapted from Chronicle's existing N3/Turtle → TypeScript/Zod
pipeline. It handles inheritance, domain/range, and OWL cardinality and fails for
cyclic inheritance or undeclared referenced classes. The minimal package has no
persistence metadata, derived effects, runtime filesystem parser, or full ontology.
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
and term pages should serve the latest released version, rather than unreleased
changes on `main`. Website hosting is not configured yet; see
[Preparing a release](../../RELEASING.md) for the release procedure.

This package is **not a drop-in replacement** for the full internal schema. The
private ontology and its existing consumers remain in place. Add vocabulary only
when a migrating plugin requires it, preserving existing term identifiers and
meanings; regenerate and add focused tests alongside each addition. Consumer
cutovers wait until the required vocabulary exists and compatibility is verified.

Node.js 22.13+. MIT covers the ontology, generator, generated code, and docs;
see [LICENSE](LICENSE).
