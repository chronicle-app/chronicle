# Chronicle schema site

The documentation site for the Chronicle schema, built with
[Astro](https://astro.build) and served at
https://schema.chronicle.app: guides, a page for every class and property,
example records in Chronicle JSON, JSON-LD, and Turtle, a validator for pasted
records, and search on every page (<kbd>⌘K</kbd>, <kbd>Ctrl K</kbd>, or
<kbd>/</kbd>). This package is private and is not published to npm.

```bash
npm run schema:docs          # serve at http://localhost:4321, rebuilding on change
npm run schema:docs:build    # write the static site to apps/schema-site/build/site
```

The site is generated and not committed. It is built from three sources:

- [chronicle.ttl](../../core/schema/chronicle.ttl): the classes and properties.
- [examples.ttl](../../core/schema/examples.ttl): example records. Each has an
  `rdfs:label` title, an `rdfs:comment` explanation, and a sample record under
  `rdf:value`, written as nested blank nodes. `doc:key` lists identity fields and
  becomes `@key` in Chronicle JSON. Link an example from the terms it shows with
  `skos:example`. Keep examples synthetic: made-up people, accounts, and
  identifiers.
- [guides/](guides): Markdown guides, ordered by filename. Link to the reference
  with `example:<id>`, `class:<Name>`, or `property:<name>`, and to other guides
  by filename; `:Term` in text links to that term.

The site reads both Turtle files from `core/schema` by path rather than through
the installed package, so a release tag's site is rebuilt from that tag's
vocabulary. `npm test` validates every example against the generated Zod
schemas (run `npm run build` first) and builds the site, failing on broken
links.

## Layout

- [src/pages](src/pages): one Astro page per kind of page, generated from the
  schema with `getStaticPaths`. [src/components](src/components) holds the
  shared pieces (property tables, format tabs, term links) and
  [src/layouts](src/layouts) the page shell.
- [src/lib](src/lib): reads the Turtle files and guides (`model.js`,
  `guides.js`) and derives what the pages share (`site.js`). Pages are bundled,
  so the data directories are passed in through Vite `define` rather than
  found relative to the modules; see [scripts/directories.js](scripts/directories.js).
  `validate.js` checks records for the validator page, which bundles the
  generated Zod schemas from `core/schema/src` by path, like the Turtle files.
  `locate.js` finds each issue in the pasted text, and `validator-presets.js`
  holds the failing examples.
- [public/assets](public/assets): the stylesheet, the search and tab script,
  and images, copied as they are.
- [scripts](scripts): the build, the deployment, and the tests.

Links go through `url()` in `site.js`, which prefixes the base path the site is
built for, so a release snapshot links within its own path. Astro telemetry is
turned off for the npm scripts.

## Deployment

The site is served from Cloudflare Workers static assets
([wrangler.jsonc](wrangler.jsonc)). It is deployed from `main` whenever the
schema or the site changes there, and again after each release:

```bash
npm run schema:docs:deploy-build   # write the deployable site to apps/schema-site/build/deploy
```

The root is `main`. `releases/<version>/` holds the first release of each
vocabulary version, rebuilt from its tag. Term IRIs such as `/Task` redirect to
their pages. The build fails if a rebuilt snapshot differs from the published
one.
