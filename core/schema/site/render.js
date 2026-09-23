import { escape, firstSentence, paths, slugify, TERM } from './html.js';

const REPOSITORY = 'https://github.com/chronicle-app/chronicle';
const cardinality = property =>
  (property.max === 1
    ? '<span class="tag">one</span>'
    : '<span class="tag tag-many" title="Takes a list of values">many</span>') +
  (property.min > 0 ? ' <span class="tag tag-required">required</span>' : '');
const plural = name => (name.endsWith('y') ? name.slice(0, -1) + 'ies' : name + 's');
const root = path => '../'.repeat(path.split('/').length - 1);

/**
 * Renders every page of the site. Returns [{ path, title, kind, description,
 * html, search }], where `path` is relative to the site root.
 */
export function renderSite(schema, guides) {
  const { classes, properties, examples } = schema;

  // ---------------------------------------------------------------- links

  // Links are written from the site root and made relative per page.
  const classLink = name =>
    classes.has(name)
      ? `<a class="term" href="{root}${paths.class(name)}">${escape(name)}</a>`
      : escape(name);
  const propertyLink = name =>
    properties.has(name)
      ? `<a class="term property" href="{root}${paths.property(name)}">${escape(name)}</a>`
      : escape(name);
  const termLink = name =>
    classes.has(name) ? classLink(name) : properties.has(name) ? propertyLink(name) : null;

  function prose(text = '') {
    return text
      .split(/(`[^`]+`)/g)
      .map(part => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1)
          return `<code>${escape(part.slice(1, -1))}</code>`;
        let html = '';
        let cursor = 0;
        for (const match of part.matchAll(TERM)) {
          const link = termLink(match[0].slice(1));
          if (!link) continue;
          html += escape(part.slice(cursor, match.index)) + link;
          cursor = match.index + match[0].length;
        }
        return html + escape(part.slice(cursor));
      })
      .join('');
  }
  const paragraphs = text =>
    text
      .split(/\n\s*\n/)
      .filter(paragraph => paragraph.trim())
      .map(paragraph => `<p>${prose(paragraph.replaceAll(/\s*\n\s*/g, ' '))}</p>`)
      .join('');

  // ------------------------------------------------------- class structure

  const lineage = name => {
    // One path from a root to the class, following first parents.
    const path = [name];
    while (classes.get(path[0]).parents.length > 0) path.unshift(classes.get(path[0]).parents[0]);
    return path;
  };
  // Record classes descend from a root with subclasses (Base); its children are
  // the families (Action, Entity). Standalone roots are datatypes.
  const roots = [...classes.values()].filter(cls => cls.parents.length === 0);
  const recordRoots = roots.filter(cls => cls.children.length);
  const datatypes = roots.filter(cls => cls.children.length === 0);
  const families = recordRoots.flatMap(cls => cls.children.map(name => classes.get(name)));
  const isA = (name, ancestor) =>
    name === ancestor || classes.get(name).ancestors.includes(ancestor);
  const descendants = name =>
    [...classes.values()].filter(cls => cls.ancestors.includes(name)).map(cls => cls.name);

  const expected = property =>
    property.range.map(name => classLink(name)).join(' <span class="or">or</span> ');

  function tree(name, { describe = false, depth = 0 } = {}) {
    const cls = classes.get(name);
    const children = cls.children.map(child => tree(child, { describe, depth: depth + 1 }));
    return `<li>${classLink(name)}${describe && cls.comment ? `<span class="tree-note">${prose(firstSentence(cls.comment))}</span>` : ''}${children.length > 0 ? `<ul>${children.join('')}</ul>` : ''}</li>`;
  }

  // --------------------------------------------------------- code blocks

  function jsonHtml(value, indent = 0, key = null) {
    const pad = '  '.repeat(indent);
    if (Array.isArray(value)) {
      if (value.every(item => typeof item !== 'object')) {
        const inline = `[${value.map(item => jsonHtml(item, 0, key)).join(', ')}]`;
        const width = JSON.stringify(value).length + pad.length + (key?.length ?? 0);
        if (width < 84) return inline;
      }
      return `[\n${value.map(item => `${pad}  ${jsonHtml(item, indent + 1, key)}`).join(',\n')}\n${pad}]`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value).map(([name, item]) => {
        const link = !name.startsWith('@') && properties.has(name);
        const label = link
          ? `"<a class="code-link" href="{root}${paths.property(name)}">${escape(name)}</a>"`
          : `"${escape(name)}"`;
        return `${pad}  <span class="json-key">${label}</span>: ${jsonHtml(item, indent + 1, name)}`;
      });
      return `{\n${entries.join(',\n')}\n${pad}}`;
    }
    if (typeof value === 'string') {
      if (key === '@type' && classes.has(value)) {
        return `<span class="json-string">"<a class="code-link" href="{root}${paths.class(value)}">${escape(value)}</a>"</span>`;
      }
      return `<span class="json-string">${escape(JSON.stringify(value))}</span>`;
    }
    return `<span class="json-literal">${escape(JSON.stringify(value))}</span>`;
  }

  function turtleHtml(text) {
    let html = '';
    let cursor = 0;
    const pattern = /"(?:\\.|[^"\\])*"|@prefix[^\n]*|(?<![\w:]):[A-Za-z][A-Za-z0-9]*|\bdoc:key\b/g;
    for (const match of text.matchAll(pattern)) {
      const token = match[0];
      html += escape(text.slice(cursor, match.index));
      if (token.startsWith('"')) html += `<span class="json-string">${escape(token)}</span>`;
      else if (token.startsWith('@prefix'))
        html += `<span class="ttl-prefix">${escape(token)}</span>`;
      else if (token === 'doc:key') html += `<span class="ttl-doc">${token}</span>`;
      else {
        const name = token.slice(1);
        const target = classes.has(name)
          ? paths.class(name)
          : properties.has(name)
            ? paths.property(name)
            : null;
        html += target
          ? `<a class="code-link" href="{root}${target}">${escape(token)}</a>`
          : escape(token);
      }
      cursor = match.index + token.length;
    }
    return html + escape(text.slice(cursor));
  }

  let exampleCount = 0;
  function payload(example) {
    const id = `payload-${exampleCount++}`;
    const formats = [
      ['chronicle', 'Chronicle JSON', jsonHtml(example.chronicle)],
      ['jsonld', 'JSON-LD', jsonHtml(example.jsonld)],
      ['turtle', 'Turtle', turtleHtml(example.turtle)],
    ];
    return `<div class="payload" data-payload>
      <div class="payload-bar">
        <div class="tabs" role="tablist" aria-label="Format">${formats
          .map(
            ([format, label], index) =>
              `<button type="button" role="tab" id="${id}-${format}-tab" aria-controls="${id}-${format}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-format="${format}">${label}</button>`
          )
          .join('')}</div>
        <button type="button" class="copy" data-copy><span>Copy</span></button>
      </div>
      ${formats
        .map(
          ([format, , html], index) =>
            `<pre role="tabpanel" id="${id}-${format}" aria-labelledby="${id}-${format}-tab" data-panel="${format}" tabindex="0"${index ? ' hidden' : ''}><code>${html}</code></pre>`
        )
        .join('')}
    </div>`;
  }

  const exampleCard = example =>
    `<a class="card example-card" href="{root}${paths.example(example.id)}">
      <span class="card-kicker">${escape(example.chronicle['@type'])}</span>
      <strong>${escape(example.title)}</strong>
      <span class="card-text">${escape(firstSentence(example.body).replaceAll(TERM, match => match.slice(1)))}</span>
    </a>`;

  function examplesSection(list, heading = 'Examples') {
    if (list.length === 0) return '';
    return `<section id="examples"><h2>${heading}</h2>${list
      .map(
        example => `<article class="example">
          <header><h3><a href="{root}${paths.example(example.id)}">${escape(example.title)}</a></h3></header>
          ${paragraphs(firstSentence(example.body))}
          ${payload(example)}
        </article>`
      )
      .join('')}</section>`;
  }

  // ---------------------------------------------------------------- pages

  const pages = [];
  const add = page => pages.push(page);

  // Home
  const featured = schema.overview[0];
  add({
    path: 'index.html',
    kind: 'home',
    title: 'Chronicle Schema',
    description:
      'Reference for the Chronicle schema: classes, properties, guides, and example records.',
    html: `
      <section class="hero">
        <p class="eyebrow">Version ${escape(schema.version)}</p>
        <h1>Chronicle Schema</h1>
        <p class="lead">The classes and properties Chronicle’s plugins use to describe messages, shell commands, to-dos, and AI conversations. It has ${classes.size} classes and ${properties.size} properties.</p>
        <div class="actions">
          <a class="button primary" href="{root}${paths.guide(guides[0].slug)}">Read the guides</a>
          <a class="button" href="{root}classes/index.html">Browse classes</a>
          <button type="button" class="button ghost" data-open-search>Search <kbd data-shortcut>⌘K</kbd></button>
        </div>
      </section>
      ${
        featured
          ? `<section class="feature">
        <div class="feature-text">
          <h2>Example: ${escape(featured.title.toLowerCase())}</h2>
          ${paragraphs(featured.body.split(/\n\s*\n/)[0])}
          <p><a href="{root}${paths.example(featured.id)}">Open this example →</a></p>
        </div>
        ${payload(featured)}
      </section>`
          : ''
      }
      <section>
        <h2>Guides</h2>
        <div class="grid">
          ${guides
            .map(
              guide => `<a class="card" href="{root}${paths.guide(guide.slug)}">
                <span class="card-kicker">Guide ${guide.number}</span>
                <strong>${escape(guide.title)}</strong>
                <span class="card-text">${prose(firstSentence(guide.lead))}</span>
              </a>`
            )
            .join('')}
        </div>
      </section>
      <section class="split">${families
        .map(
          family => `<div>
          <h2>${plural(family.name)}</h2>
          <ul class="term-list">${descendants(family.name)
            .sort()
            .map(
              name =>
                `<li>${classLink(name)}<span>${prose(firstSentence(classes.get(name).comment))}</span></li>`
            )
            .join('')}</ul>
        </div>`
        )
        .join('')}</section>
      ${
        schema.overview.length > 1
          ? `<section><h2>More examples</h2><div class="grid">${schema.overview
              .slice(1)
              .map(example => exampleCard(example))
              .join(
                ''
              )}<a class="card card-more" href="{root}examples/index.html"><strong>All ${examples.length} examples →</strong></a></div></section>`
          : ''
      }`,
  });

  // Guides
  add({
    path: 'guides/index.html',
    kind: 'guides',
    title: 'Guides',
    description: 'Guides to the Chronicle record format.',
    html: `<header class="page-header"><p class="eyebrow">Guides</p><h1>Guides</h1><p class="lead">Read these in order. Each one links to example records.</p></header>
      <ol class="guide-list">${guides
        .map(
          guide =>
            `<li><a href="{root}${paths.guide(guide.slug)}"><span class="guide-number">${guide.number}</span><span><strong>${escape(guide.title)}</strong><span class="card-text">${prose(guide.lead)}</span></span></a></li>`
        )
        .join('')}</ol>`,
  });
  for (const [index, guide] of guides.entries()) {
    const previous = guides[index - 1];
    const next = guides[index + 1];
    add({
      path: paths.guide(guide.slug),
      kind: 'guide',
      title: guide.title,
      description: guide.lead,
      toc: guide.headings,
      search: guide.text,
      html: `<header class="page-header"><p class="eyebrow">Guide ${guide.number} of ${guides.length}</p><h1>${escape(guide.title)}</h1></header>
        <article class="prose">${guide.html}</article>
        <nav class="pager" aria-label="Guides">
          ${previous ? `<a class="card" href="{root}${paths.guide(previous.slug)}"><span class="card-kicker">Previous</span><strong>${escape(previous.title)}</strong></a>` : '<span></span>'}
          ${next ? `<a class="card next" href="{root}${paths.guide(next.slug)}"><span class="card-kicker">Next</span><strong>${escape(next.title)}</strong></a>` : `<a class="card next" href="{root}examples/index.html"><span class="card-kicker">Next</span><strong>Examples</strong></a>`}
        </nav>`,
    });
  }

  // Classes
  add({
    path: 'classes/index.html',
    kind: 'classes',
    title: 'Classes',
    description: 'Every class in the Chronicle vocabulary, by family.',
    toc: [
      ...families.map(family => ({ id: slugify(plural(family.name)), title: plural(family.name) })),
      ...(datatypes.length > 0 ? [{ id: 'datatypes', title: 'Datatypes' }] : []),
    ],
    html: `<header class="page-header"><p class="eyebrow">Reference</p><h1>Classes</h1><p class="lead">A class is a kind of record. Every record is ${families.map(family => `${/^[AEIOU]/.test(family.name) ? 'an' : 'a'} ${classLink(family.name)}`).join(' or ')}, descended from ${recordRoots.map(cls => classLink(cls.name)).join(' and ')}. A class inherits every property of the classes above it.</p></header>
      ${families
        .map(
          family =>
            `<section id="${slugify(plural(family.name))}"><h2>${plural(family.name)}</h2><p>${prose(family.comment)}</p><ul class="tree">${tree(family.name, { describe: true })}</ul></section>`
        )
        .join('')}
      <section id="datatypes"><h2>Datatypes</h2><p>Plain values carried directly by properties. They have no identity of their own.</p><ul class="term-list">${datatypes.map(cls => `<li>${classLink(cls.name)}<span>${prose(firstSentence(cls.comment))}</span></li>`).join('')}</ul></section>`,
  });

  for (const cls of classes.values()) {
    const groups = [cls.name, ...cls.ancestors]
      .map(name => ({ name, properties: classes.get(name).properties }))
      .filter(group => group.properties.length);
    const table =
      groups.length > 0
        ? `<div class="table-wrap"><table class="properties">
          <thead><tr><th scope="col">Property</th><th scope="col">Expected type</th><th scope="col">Description</th></tr></thead>
          ${groups
            .map(
              group => `<tbody><tr class="group"><th colspan="3" scope="colgroup">${group.name === cls.name ? `Properties of ${escape(cls.name)}` : `From ${classLink(group.name)}`}</th></tr>
              ${group.properties
                .map(name => {
                  const property = properties.get(name);
                  return `<tr><th scope="row">${propertyLink(name)} ${cardinality(property)}</th><td>${expected(property)}</td><td>${prose(property.comment)}</td></tr>`;
                })
                .join('')}</tbody>`
            )
            .join('')}
        </table></div>`
        : '<p class="muted">This class has no properties. It is carried directly as a value.</p>';
    const usedAs = [...properties.values()]
      .flatMap(property =>
        property.range
          .filter(range => isA(cls.name, range))
          .map(range => ({ property, via: range === cls.name ? null : range }))
      )
      .sort((a, b) => Number(Boolean(a.via)) - Number(Boolean(b.via)));
    const toc = [
      { id: 'properties', title: 'Properties' },
      ...(usedAs.length > 0 ? [{ id: 'used-as', title: 'Used as a value' }] : []),
      ...(cls.children.length > 0 ? [{ id: 'subclasses', title: 'Subclasses' }] : []),
      ...(cls.examples.length > 0 ? [{ id: 'examples', title: 'Examples' }] : []),
    ];
    add({
      path: paths.class(cls.name),
      kind: 'class',
      title: cls.name,
      description: cls.comment,
      toc,
      search: [...groups.flatMap(group => group.properties), ...cls.ancestors].join(' '),
      html: `<header class="page-header">
          <nav class="lineage" aria-label="Class hierarchy">${lineage(cls.name)
            .map(name =>
              name === cls.name
                ? `<span aria-current="page">${escape(name)}</span>`
                : classLink(name)
            )
            .join('<span class="sep" aria-hidden="true">›</span>')}</nav>
          <h1>${escape(cls.name)}</h1>
          ${cls.comment ? `<p class="lead">${prose(cls.comment)}</p>` : ''}
        </header>
        <section id="properties"><h2>Properties</h2>${table}</section>
        ${
          usedAs.length > 0
            ? `<section id="used-as"><h2>Used as a value</h2><p>A ${escape(cls.name)} can be the value of these properties.</p><ul class="term-list">${usedAs
                .map(
                  ({ property, via }) =>
                    `<li>${propertyLink(property.name)}<span>on ${property.domain.map(name => classLink(name)).join(', ')}${via ? ` · accepts any ${classLink(via)}` : ''}</span></li>`
                )
                .join('')}</ul></section>`
            : ''
        }
        ${
          cls.children.length > 0
            ? `<section id="subclasses"><h2>Subclasses</h2><div class="grid">${cls.children
                .map(
                  child =>
                    `<a class="card" href="{root}${paths.class(child)}"><strong>${escape(child)}</strong><span class="card-text">${escape(firstSentence(classes.get(child).comment).replaceAll(TERM, match => match.slice(1)))}</span></a>`
                )
                .join('')}</div></section>`
            : ''
        }
        ${examplesSection(cls.examples)}
        <p class="uri">URI <code>${escape(cls.uri)}</code></p>`,
    });
  }

  // Properties
  const propertyGroups = [...classes.values()]
    .filter(cls => cls.properties.length)
    .sort(
      (a, b) =>
        a.ancestors.length - b.ancestors.length ||
        lineage(a.name).join('/').localeCompare(lineage(b.name).join('/'))
    );
  add({
    path: 'properties/index.html',
    kind: 'properties',
    title: 'Properties',
    description:
      'Every property in the Chronicle vocabulary, grouped by the class that declares it.',
    toc: propertyGroups.map(cls => ({ id: `on-${slugify(cls.name)}`, title: cls.name })),
    html: `<header class="page-header"><p class="eyebrow">Reference</p><h1>Properties</h1><p class="lead">A property is a field of a record: a plain value or a link to another record. Cardinality in the ontology sets how many values a property takes: <span class="tag">one</span> means at most one value, <span class="tag tag-many">many</span> means a list, and <span class="tag tag-required">required</span> means a record of that class must have it (<code>owl:minCardinality 1</code>).</p></header>
      ${propertyGroups
        .map(
          cls =>
            `<section id="on-${slugify(cls.name)}"><h2>On ${classLink(cls.name)}</h2><div class="table-wrap"><table class="properties"><thead><tr><th scope="col">Property</th><th scope="col">Expected type</th><th scope="col">Description</th></tr></thead><tbody>${cls.properties
              .map(name => {
                const property = properties.get(name);
                return `<tr><th scope="row">${propertyLink(name)} ${cardinality(property)}</th><td>${expected(property)}</td><td>${prose(firstSentence(property.comment))}</td></tr>`;
              })
              .join('')}</tbody></table></div></section>`
        )
        .join('')}`,
  });

  for (const property of properties.values()) {
    add({
      path: paths.property(property.name),
      kind: 'property',
      title: property.name,
      description: property.comment,
      search: [...property.domain, ...property.range].join(' '),
      toc: property.examples.length > 0 ? [{ id: 'examples', title: 'Examples' }] : [],
      html: `<header class="page-header">
          <p class="eyebrow">Property</p>
          <h1 class="mono">${escape(property.name)}</h1>
          ${property.comment ? `<p class="lead">${prose(property.comment)}</p>` : ''}
        </header>
        <dl class="facts">
          <div><dt>Used on</dt><dd>${property.domain.map(name => classLink(name)).join(', ')}<span class="muted"> and their subclasses</span></dd></div>
          <div><dt>Expected type</dt><dd>${expected(property)}</dd></div>
          <div><dt>Values</dt><dd>${property.max === 1 ? 'At most one value' : 'A list of values'}</dd></div>
          <div><dt>Required</dt><dd>${property.min > 0 ? 'Yes' : 'No'}</dd></div>
        </dl>
        ${examplesSection(property.examples)}
        <p class="uri">URI <code>${escape(property.uri)}</code></p>`,
    });
  }

  // Examples
  add({
    path: 'examples/index.html',
    kind: 'examples',
    title: 'Examples',
    description: 'Example records in Chronicle JSON, JSON-LD, and Turtle.',
    html: `<header class="page-header"><p class="eyebrow">Reference</p><h1>Examples</h1><p class="lead">${examples.length} example records based on the output of Chronicle’s plugins, in Chronicle JSON, JSON-LD, and Turtle. The people, accounts, and identifiers are made up.</p></header>
      <div class="grid">${examples.map(example => exampleCard(example)).join('')}</div>`,
  });
  for (const example of examples) {
    add({
      path: paths.example(example.id),
      kind: 'example',
      title: example.title,
      description: example.body,
      search: example.usedBy.join(' '),
      html: `<header class="page-header"><p class="eyebrow"><a href="{root}examples/index.html">Examples</a></p><h1>${escape(example.title)}</h1></header>
        <div class="prose">${paragraphs(example.body)}</div>
        ${payload(example)}
        ${example.usedBy.length > 0 ? `<section><h2>Terms in this example</h2><p class="chips">${example.usedBy.map(name => termLink(name)).join('')}</p></section>` : ''}`,
    });
  }

  // ------------------------------------------------------------- layout

  const sidebar = current => {
    const item = (path, label) =>
      `<a href="{root}${path}"${path === current ? ' aria-current="page"' : ''}>${label}</a>`;
    const open = prefix => (current.startsWith(prefix) ? ' open' : '');
    return `<nav class="sidebar-nav" aria-label="Site">
      ${item('index.html', 'Overview')}
      <p class="nav-heading">Guides</p>
      ${guides.map(guide => item(paths.guide(guide.slug), escape(guide.title))).join('')}
      <p class="nav-heading">Reference</p>
      ${item('classes/index.html', 'Classes')}
      ${item('properties/index.html', 'Properties')}
      ${item('examples/index.html', 'Examples')}
      <details${open('classes/')}><summary>All classes <span class="count">${classes.size}</span></summary>
        ${[...classes.keys()].map(name => item(paths.class(name), escape(name))).join('')}
      </details>
      <details${open('properties/')}><summary>All properties <span class="count">${properties.size}</span></summary>
        ${[...properties.keys()].map(name => item(paths.property(name), `<code>${escape(name)}</code>`)).join('')}
      </details>
      <details${open('examples/')}><summary>All examples <span class="count">${examples.length}</span></summary>
        ${examples.map(example => item(paths.example(example.id), escape(example.title))).join('')}
      </details>
    </nav>`;
  };

  for (const page of pages) {
    const toc = page.toc?.length
      ? `<aside class="toc" aria-label="On this page"><p>On this page</p>${page.toc.map(entry => `<a href="#${entry.id}">${escape(entry.title)}</a>`).join('')}</aside>`
      : '';
    const document = `<!doctype html>
<html lang="en" data-root="{root}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.kind === 'home' ? 'Chronicle Schema' : `${escape(page.title)} · Chronicle Schema`}</title>
<meta name="description" content="${escape(firstSentence(page.description ?? ''))}">
<link rel="icon" href="{root}assets/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="{root}assets/apple-touch-icon.png">
<link rel="stylesheet" href="{root}assets/site.css">
<script>try{const t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch{}</script>
<script src="{root}assets/search-index.js" defer></script>
<script src="{root}assets/site.js" defer></script>
</head>
<body class="page-${page.kind}">
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <button type="button" class="icon-button menu-button" aria-label="Menu" aria-expanded="false" aria-controls="sidebar" data-menu>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/></svg>
  </button>
  <a class="brand" href="{root}index.html"><span class="brand-mark" aria-hidden="true"></span><span>Chronicle</span><span class="brand-sub">Schema</span></a>
  <button type="button" class="search-trigger" data-open-search aria-haspopup="dialog" aria-controls="search-dialog">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
    <span>Search</span><kbd data-shortcut>⌘K</kbd>
  </button>
  <nav class="top-links" aria-label="Resources">
    <a href="{root}chronicle.ttl" download>chronicle.ttl</a>
    <a href="${REPOSITORY}">GitHub</a>
    <button type="button" class="icon-button" data-theme-toggle aria-label="Toggle dark mode">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9Z"/></svg>
    </button>
  </nav>
</header>
<div class="shell">
  <aside class="sidebar" id="sidebar">${sidebar(page.path)}</aside>
  <main id="main" tabindex="-1">
    <div class="content${toc ? ' has-toc' : ''}">
      <div class="article">${page.html}</div>
      ${toc}
    </div>
    <footer class="footer">
      <span>Chronicle vocabulary v${escape(schema.version)}</span>
      <span>Namespace <code>https://schema.chronicle.app/</code></span>
      <a href="{root}chronicle.ttl" download>Download the ontology</a>
    </footer>
  </main>
</div>
<dialog id="search-dialog" aria-label="Search">
  <div class="search-field">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
    <input id="search" type="search" placeholder="Search guides, classes, properties, examples" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results" aria-describedby="search-status">
    <kbd>Esc</kbd>
  </div>
  <ul id="search-results" role="listbox" aria-label="Results"></ul>
  <p id="search-status" class="search-status" role="status" aria-live="polite"></p>
  <div class="search-help"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>/</kbd> or <kbd data-shortcut>⌘K</kbd> to search</span></div>
</dialog>
</body>
</html>
`;
    page.document = document.replaceAll('{root}', root(page.path));
  }

  return pages;
}
