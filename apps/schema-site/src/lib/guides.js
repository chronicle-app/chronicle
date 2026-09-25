import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import MarkdownIt from 'markdown-it';
import { escape, paths, slugify, TERM } from './html.js';

const slugOf = file => file.replace(/\.md$/, '').replace(/^\d+-/, '');
const defaultRender = (tokens, i, options, env, self) => self.renderToken(tokens, i, options);

/**
 * Guides are ordinary Markdown files, read in filename order. Besides links
 * between guides, a guide can link into the reference with `example:<id>`,
 * `class:<Name>`, or `property:<name>`, and `:Term` in text links to that
 * term. An image of a local .svg file is inlined as a figure, so it can use
 * the site's colours and link to the reference the same way. Every link is
 * checked when the site is built.
 */
export async function loadGuides(schema, directory) {
  const files = (await readdir(directory)).filter(file => file.endsWith('.md')).sort();
  const exampleIds = new Set(schema.examples.map(example => example.id));
  const indexes = new Set(['classes/index.html', 'properties/index.html', 'examples/index.html']);

  // `:Term` references in text become links to the reference.
  function linkTerms(content) {
    let html = '';
    let cursor = 0;
    for (const match of content.matchAll(TERM)) {
      const name = match[0].slice(1);
      const isClass = schema.classes.has(name);
      if (!isClass && !schema.properties.has(name)) continue;
      const target = isClass ? paths.class(name) : paths.property(name);
      html += escape(content.slice(cursor, match.index));
      html += `<a class="term${isClass ? '' : ' property'}" href="../${target}">${escape(name)}</a>`;
      cursor = match.index + match[0].length;
    }
    return html + escape(content.slice(cursor));
  }

  function destination(href, file) {
    const [, scheme, name] = href.match(/^(example|class|property):(.+)$/) ?? [];
    if (scheme === 'example' && exampleIds.has(name)) return paths.example(name);
    if (scheme === 'class' && schema.classes.has(name)) return paths.class(name);
    if (scheme === 'property' && schema.properties.has(name)) return paths.property(name);
    if (!scheme && files.includes(href)) return paths.guide(slugOf(href));
    if (!scheme && href.startsWith('../') && indexes.has(href.slice(3))) return href.slice(3);
    throw new Error(`Broken link in guide ${file}: ${href}`);
  }

  return Promise.all(
    files.map(async (file, index) => {
      const source = await readFile(join(directory, file), 'utf8');
      const heading = source.match(/^# (.+)\r?\n/);
      if (!heading) throw new Error(`Guide ${file} must start with a level-one heading`);
      const body = source.slice(heading[0].length).trim();
      const markdown = new MarkdownIt();
      const headings = [];
      const { rules } = markdown.renderer;

      rules.link_open = (tokens, i, options, env, self) => {
        const token = tokens[i];
        const href = token.attrGet('href');
        if (!/^(https?:|mailto:|#)/.test(href)) {
          token.attrSet('href', '../' + destination(href, file));
        }
        return defaultRender(tokens, i, options, env, self);
      };
      rules.image = (tokens, i) => {
        const token = tokens[i];
        const source = token.attrGet('src');
        if (/^https?:/.test(source) || !source.endsWith('.svg')) {
          throw new Error(`Guide ${file}: only local SVG diagrams are supported (${source})`);
        }
        const svg = readFileSync(join(directory, source), 'utf8').replaceAll(
          /href="([^"]+)"/g,
          (_, href) => `href="../${destination(href, file)}"`
        );
        const caption = token.attrGet('title');
        return `<figure class="diagram">${svg}${caption ? `<figcaption>${linkTerms(caption)}</figcaption>` : ''}</figure>`;
      };
      rules.heading_open = (tokens, i, options, env, self) => {
        const token = tokens[i];
        const title = tokens[i + 1].content;
        if (token.tag === 'h2') {
          const id = slugify(title);
          token.attrSet('id', id);
          headings.push({ id, title });
        }
        return defaultRender(tokens, i, options, env, self);
      };
      // Link :Term references in text, but not inside links or code.
      rules.text = (tokens, i) => {
        const { content } = tokens[i];
        const inLink = tokens
          .slice(0, i)
          .reduce(
            (depth, token) =>
              depth + (token.type === 'link_open' ? 1 : token.type === 'link_close' ? -1 : 0),
            0
          );
        // Inside a link, `:Term` is just the term's name.
        if (inLink) return escape(content.replaceAll(TERM, match => match.slice(1)));
        return linkTerms(content);
      };

      // A diagram stands alone, so it should not stay inside a paragraph.
      const html = markdown
        .render(body)
        .replaceAll(/<p>(<figure class="diagram">[\s\S]*?<\/figure>)<\/p>/g, '$1');
      const lead = body.split(/\n\s*\n/)[0].replaceAll(/\s+/g, ' ');
      return {
        slug: slugOf(file),
        number: index + 1,
        title: heading[1],
        lead,
        html,
        headings,
        text: body.replaceAll(/[#*`[\]()]/g, ' '),
      };
    })
  );
}
