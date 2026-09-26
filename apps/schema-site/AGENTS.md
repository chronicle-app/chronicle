# Working on the schema site

[README.md](README.md) describes how the site is built, the examples format,
and the link syntax guides use.

- Guides are for plugin authors. Teach with examples from
  `core/schema/examples.ttl` rather than new snippets, and describe only what
  the vocabulary has today.
- Keep examples synthetic: made-up people, accounts, and identifiers. Link each
  new example from the terms it shows with `skos:example`.
- A guide's first paragraph is its description in search and on the home page.
  Its `##` headings are link targets, and the home page links to some of them,
  so renaming one can break a link.
- Diagrams are local SVG files. Use the site's CSS variables with a fallback,
  such as `var(--accent, #c8323e)`, so they work in both themes.
- Run `npm test` here after any change. It builds the site and fails on broken
  links and invalid examples.
