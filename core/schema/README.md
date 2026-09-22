# @chronicle.app/schema

A deliberately small extraction vocabulary with generated TypeScript interfaces
and Zod validators. The canonical file is [schema.ttl](schema.ttl); edit it and run
`npm run schema:generate` from the repository root. `npm run schema:check` verifies
that committed output matches the ontology without rewriting it.

## Vocabulary

- `Base`: an identity-bearing node; carries `sourceId`.
- `Entity`: a thing described by a source; adds `name` and `url`.
- `Action`: an occurrence; adds a single entity-valued `object`.

`Text` and `URL` are literal datatypes. All four properties are optional and
single-valued. Records carry `@type` and at least one of `@key` (a nonempty list of
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
that also accepts its descendants. `BaseAndChildrenSchema` accepts all three
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

This package is **not a drop-in replacement** for the full internal schema. The
private ontology and its existing consumers remain in place. Add vocabulary only
when a migrating plugin requires it, preserving existing term identifiers and
meanings; regenerate and add focused tests alongside each addition. Consumer
cutovers wait until the required vocabulary exists and compatibility is verified.

Node.js 22.13+. MIT covers the ontology, generator, generated code, and docs;
see [LICENSE](LICENSE).
