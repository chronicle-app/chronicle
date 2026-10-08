// The schema and guides, read once per build, with the derived structure the
// pages share. The build defines the data directories and the build info (see
// astro.config.mjs).
/* global __SCHEMA_DIRECTORY__, __GUIDES_DIRECTORY__, __VOCABULARIES_DIRECTORY__, __BUILD_INFO__ */
import { join } from 'node:path';
import { findTerm, REFERENCE } from './alignments.js';
import { loadGuides } from './guides.js';
import { paths, TERM } from './html.js';
import { readSchema } from './model.js';

export { escape, firstSentence, paths, slugify, TERM } from './html.js';

export const ONTOLOGY_FILE = join(__SCHEMA_DIRECTORY__, 'chronicle.ttl');
export const alignmentFile = id => join(__SCHEMA_DIRECTORY__, 'alignments', `${id}.ttl`);
export const schema = await readSchema(__SCHEMA_DIRECTORY__);
export const guides = await loadGuides(schema, __GUIDES_DIRECTORY__);
export const { classes, properties, examples } = schema;

// The vocabularies Chronicle's terms relate to, in the order of their
// comparisons, each with its comparison. Every alignment needs one.
const comparisons = await loadGuides(schema, __VOCABULARIES_DIRECTORY__);
export const vocabularies = comparisons.map(comparison => {
  const vocabulary = schema.vocabularies.find(candidate => candidate.id === comparison.slug);
  if (!vocabulary) throw new Error(`No alignment for the comparison ${comparison.slug}`);
  return { ...vocabulary, comparison };
});
for (const { id } of schema.vocabularies) {
  if (!vocabularies.some(vocabulary => vocabulary.id === id))
    throw new Error(`alignments/${id}.ttl needs a comparison in vocabularies/`);
}
const position = new Map(vocabularies.map((vocabulary, index) => [vocabulary.id, index]));
for (const term of [...classes.values(), ...properties.values()]) {
  term.alignments.sort((a, b) => position.get(a.vocabulary) - position.get(b.vocabulary));
}
export const vocabularyById = new Map(vocabularies.map(vocabulary => [vocabulary.id, vocabulary]));

/** How a Chronicle term relates to another vocabulary's term, as pages say it. */
export const RELATIONS = {
  same: 'Same as',
  narrower: 'A kind of',
  broader: 'Broader than',
  close: 'Close to',
  related: 'Related to',
  unlike: 'Not the same as',
};

// A release snapshot is served below /releases/<version>/, so every link starts
// from the base the site is built for.
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
/** A path from the site root, such as `classes/index.html`, as a link. */
export const url = path => BASE + path;

export const REPOSITORY = 'https://github.com/chronicle-app/chronicle';

/** When the site was built, and the commit it was built from (or null). */
export const build = __BUILD_INFO__;
/** The build time in UTC to the minute, such as `2026-09-28 18:30 UTC`. */
export const builtAt = `${build.time.slice(0, 10)} ${build.time.slice(11, 16)} UTC`;
export const commitUrl = commit => `${REPOSITORY}/commit/${commit}`;

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
  vocabulary: id => url(paths.vocabulary(id)),
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
  vocabularies: {
    path: 'vocabularies/index.html',
    title: 'Other vocabularies',
    description: `How Chronicle's terms relate to ${vocabularies.map(({ name }) => name).join(' and ')}.`,
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

// Record classes descend from Base; its children are the families (Action,
// Entity). Datatypes are DataType's descendants, plus any other standalone
// root. Other roots with subclasses (StructuredValue) group value types that
// have no identity of their own.
const roots = [...classes.values()].filter(cls => cls.parents.length === 0);
export const recordRoots = roots.filter(cls => cls.name === 'Base');
export const valueRoots = roots.filter(
  cls => !['Base', 'DataType'].includes(cls.name) && cls.children.length > 0
);
export const datatypes = [...classes.values()].filter(
  cls =>
    cls.name === 'DataType' ||
    cls.ancestors.includes('DataType') ||
    (cls.parents.length === 0 && cls.children.length === 0)
);
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

/**
 * Splits text into code spans, :Term links, links to other vocabularies' terms
 * (`as:origin`), and plain text.
 */
export function tokenize(text = '') {
  const tokens = [];
  for (const part of text.split(/(`[^`]+`)/g)) {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      tokens.push({ type: 'code', text: part.slice(1, -1) });
      continue;
    }
    let cursor = 0;
    for (const match of part.matchAll(REFERENCE)) {
      let token = null;
      if (match[0].startsWith(':')) {
        const name = match[0].slice(1);
        if (classes.has(name) || properties.has(name)) token = { type: 'term', name };
      } else {
        const term = findTerm(vocabularies, match[1], match[2]);
        if (term) token = { type: 'external', text: match[0], uri: term.uri };
      }
      if (!token) continue;
      tokens.push({ type: 'text', text: part.slice(cursor, match.index) }, token);
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
