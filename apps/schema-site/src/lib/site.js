// The schema and guides, read once per build, with the derived structure the
// pages share. The build defines the data directories (see astro.config.mjs).
/* global __SCHEMA_DIRECTORY__, __GUIDES_DIRECTORY__ */
import { join } from 'node:path';
import { loadGuides } from './guides.js';
import { paths, TERM } from './html.js';
import { readSchema } from './model.js';

export { escape, firstSentence, paths, slugify, TERM } from './html.js';

export const ONTOLOGY_FILE = join(__SCHEMA_DIRECTORY__, 'chronicle.ttl');
export const schema = await readSchema(__SCHEMA_DIRECTORY__);
export const guides = await loadGuides(schema, __GUIDES_DIRECTORY__);
export const { classes, properties, examples } = schema;

// A release snapshot is served below /releases/<version>/, so every link starts
// from the base the site is built for.
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
/** A path from the site root, such as `classes/index.html`, as a link. */
export const url = path => BASE + path;

export const REPOSITORY = 'https://github.com/chronicle-app/chronicle';

/** A link to the schema change issue form, with the term filled in when given. */
export function suggestChange(term) {
  const query = new URLSearchParams({ template: 'schema-change.yml' });
  query.set('title', term ? `Schema: ${term}` : 'Schema: ');
  if (term) query.set('term', term);
  return `${REPOSITORY}/issues/new?${query}`;
}

export const href = {
  class: name => url(paths.class(name)),
  property: name => url(paths.property(name)),
  example: id => url(paths.example(id)),
  guide: slug => url(paths.guide(slug)),
};

// The index pages, which the search index lists too.
export const SECTIONS = {
  home: {
    path: 'index.html',
    title: 'Chronicle Schema',
    description:
      'Reference for the Chronicle schema: classes, properties, guides, and example records.',
  },
  guides: {
    path: 'guides/index.html',
    title: 'Guides',
    description: 'Guides to the Chronicle record format.',
  },
  classes: {
    path: 'classes/index.html',
    title: 'Classes',
    description: 'Every class in the Chronicle vocabulary, by family.',
  },
  properties: {
    path: 'properties/index.html',
    title: 'Properties',
    description:
      'Every property in the Chronicle vocabulary, grouped by the class that declares it.',
  },
  examples: {
    path: 'examples/index.html',
    title: 'Examples',
    description: 'Example records in Chronicle JSON, JSON-LD, and Turtle.',
  },
  validator: {
    path: 'validator.html',
    title: 'Validator',
    description:
      'Check records in Chronicle JSON or JSON-LD against the Chronicle vocabulary, in your browser.',
  },
};

export const plural = name => (name.endsWith('y') ? name.slice(0, -1) + 'ies' : name + 's');
/** Drops the leading colon from `:Term` references, for plain-text contexts. */
export const plain = text => text.replaceAll(TERM, match => match.slice(1));

// Record classes descend from a root with subclasses (Base); its children are
// the families (Action, Entity). Standalone roots are datatypes.
const roots = [...classes.values()].filter(cls => cls.parents.length === 0);
export const recordRoots = roots.filter(cls => cls.children.length);
export const datatypes = roots.filter(cls => cls.children.length === 0);
export const families = recordRoots.flatMap(cls => cls.children.map(name => classes.get(name)));

export const isA = (name, ancestor) =>
  name === ancestor || classes.get(name).ancestors.includes(ancestor);
export const descendants = name =>
  [...classes.values()].filter(cls => cls.ancestors.includes(name)).map(cls => cls.name);

/** One path from a root to the class, following first parents. */
export function lineage(name) {
  const path = [name];
  while (classes.get(path[0]).parents.length > 0) path.unshift(classes.get(path[0]).parents[0]);
  return path;
}

/** Splits text into code spans, :Term links, and plain text. */
export function tokenize(text = '') {
  const tokens = [];
  for (const part of text.split(/(`[^`]+`)/g)) {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      tokens.push({ type: 'code', text: part.slice(1, -1) });
      continue;
    }
    let cursor = 0;
    for (const match of part.matchAll(TERM)) {
      const name = match[0].slice(1);
      if (!classes.has(name) && !properties.has(name)) continue;
      tokens.push({ type: 'text', text: part.slice(cursor, match.index) }, { type: 'term', name });
      cursor = match.index + match[0].length;
    }
    tokens.push({ type: 'text', text: part.slice(cursor) });
  }
  return tokens.filter(token => token.type !== 'text' || token.text);
}

export const paragraphs = text =>
  text
    .split(/\n\s*\n/)
    .filter(paragraph => paragraph.trim())
    .map(paragraph => paragraph.replaceAll(/\s*\n\s*/g, ' '));
