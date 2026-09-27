/**
 * HTML → text and HTML → Markdown, for the many sources that hand us markup
 * where the content is supposed to be.
 *
 * A LinkedIn InMail, a feed item's summary, a Zotero note, an email part: all
 * arrive as the producing editor's raw HTML. Storing that verbatim puts markup
 * in the body of a work, where the body is meant to be what was written.
 *
 * Both renderers run over one small tokenizer rather than over a stack of
 * regular expressions. That is what makes the Markdown side possible at all:
 * escaping is only safe when you know which characters came from the document
 * and which ones you emitted yourself, and a regex pipeline cannot tell them
 * apart. It also means a list knows its own depth and an ordered list can
 * count.
 *
 * Neither renderer invents content. An unknown entity, an unknown tag, an
 * attribute we do not read — all pass through as what the source wrote.
 */

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * The named entities real producers actually emit. An entity that is not here
 * is left exactly as written: a wrong guess puts a word in the body that nobody
 * typed, while an undecoded `&frobnicate;` is merely ugly and still honest.
 */
const NAMED_ENTITIES: { [name: string]: string } = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  bull: '•',
  middot: '·',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  trade: '™',
  reg: '®',
  copy: '©',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  micro: 'µ',
  para: '¶',
  sect: '§',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  larr: '←',
  rarr: '→',
  harr: '↔',
  darr: '↓',
  uarr: '↑',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  ntilde: 'ñ',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  szlig: 'ß',
  oslash: 'ø',
  aring: 'å',
  ae: 'æ',
};

/** Decode numeric and named character references, leaving unknown ones alone. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replaceAll(/&(#[Xx]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1] === 'x' || code[1] === 'X';
      const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(point) || point < 0 || point > 0x10_ff_ff) return match;
      // Surrogates are not characters; emitting one produces a lone surrogate
      // that breaks every downstream encoder.
      if (point >= 0xd8_00 && point <= 0xdf_ff) return match;
      return String.fromCodePoint(point);
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

/**
 * Non-breaking and typographic spaces become ordinary ones. They look identical
 * on screen but not to a search, so a body full of U+00A0 is quietly unfindable
 * by the words it plainly contains. Written as escapes because these characters
 * are invisible in source.
 */
function normalizeSpaces(text: string): string {
  return text.replaceAll(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export type HtmlToken =
  | { kind: 'text'; value: string }
  | { kind: 'open'; name: string; attrs: { [name: string]: string }; selfClosing: boolean }
  | { kind: 'close'; name: string };

/**
 * A start or end tag.
 *
 * The name must be followed by whitespace, `/`, or `>`. That single rule is
 * what keeps a bare `<https://example.com>` — which people really do type into
 * messages — from being read as a tag and deleted: a tag name cannot contain a
 * colon, so `https` never completes a match. Quoted attribute values are
 * matched as units, so a `>` inside `title="a > b"` does not end the tag early.
 */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s(?:"[^"]*"|'[^']*'|[^"'>])*)?)(\/?)>/g;

const ATTR = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Elements whose content is code for a machine, not text for a reader. */
const OPAQUE = new Set(['script', 'style', 'noscript', 'template']);

/** Elements with no closing tag, so a renderer must not wait for one. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * Walk a fragment, yielding text runs and tags in document order.
 *
 * Deliberately not a conformant parser: it does no tree building and no
 * error recovery, because every renderer here is a linear pass. Anything it
 * does not recognize as a tag — a stray `<`, a bare URL in brackets — is text,
 * which is the failure direction that keeps content rather than losing it.
 */
export function* tokenizeHtml(html: string): Generator<HtmlToken> {
  let index = 0;
  TAG.lastIndex = 0;

  while (index < html.length) {
    const next = html.indexOf('<', index);
    if (next === -1) {
      yield { kind: 'text', value: html.slice(index) };
      return;
    }

    // A comment or a doctype: skipped whole, never rendered.
    if (html.startsWith('<!--', next)) {
      if (next > index) yield { kind: 'text', value: html.slice(index, next) };
      const end = html.indexOf('-->', next + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', next)) {
      if (next > index) yield { kind: 'text', value: html.slice(index, next) };
      const end = html.indexOf('>', next + 2);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    TAG.lastIndex = next;
    const match = TAG.exec(html);
    if (!match || match.index !== next) {
      // Not a tag after all — the `<` is literal. Emit it and move past, so the
      // scan cannot loop on the same character.
      yield { kind: 'text', value: html.slice(index, next + 1) };
      index = next + 1;
      continue;
    }

    if (next > index) yield { kind: 'text', value: html.slice(index, next) };
    index = next + match[0].length;

    const closing = match[1] === '/';
    const name = match[2].toLowerCase();

    if (closing) {
      yield { kind: 'close', name };
      continue;
    }

    // An opaque element's content is skipped along with it.
    if (OPAQUE.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, index);
      index = close === -1 ? html.length : close;
      continue;
    }

    yield {
      kind: 'open',
      name,
      attrs: parseAttrs(match[3] ?? ''),
      selfClosing: match[4] === '/' || VOID.has(name),
    };
    if (VOID.has(name)) yield { kind: 'close', name };
  }
}

function parseAttrs(raw: string): { [name: string]: string } {
  const attrs: { [name: string]: string } = {};
  if (!raw.trim()) return attrs;
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(raw)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[match[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

/** Whether a string carries anything this module would treat as a tag. */
export function looksLikeHtml(html: string): boolean {
  TAG.lastIndex = 0;
  return TAG.test(html);
}

// ---------------------------------------------------------------------------
// Shared element vocabulary
// ---------------------------------------------------------------------------

/** Elements that stand on their own line. */
const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'main',
  'nav',
  'figure',
  'figcaption',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'li',
  'tr',
  'table',
  'thead',
  'tbody',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'form',
  'fieldset',
]);

/** Elements that separate cells on one line rather than starting a new one. */
const CELL = new Set(['td', 'th']);

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

/**
 * The readable text of a fragment that may or may not be HTML.
 *
 * A body with no markup comes back entity-decoded and otherwise exactly as
 * written: its line breaks are the author's own, so rebuilding them would be
 * rewriting the source. Only a body that really does carry tags has its
 * whitespace derived from the markup.
 *
 * A link keeps **both** its label and its address, as `label (url)`. Producers
 * write "here" and "read more" constantly, and dropping the URL would throw
 * away the only part that meant anything.
 *
 * Returns nothing for a fragment that is empty, or that was nothing but markup.
 */
export function htmlToText(source = ''): string | undefined {
  if (!source.trim()) return undefined;
  if (!looksLikeHtml(source)) {
    return normalizeSpaces(decodeEntities(source)).trim() || undefined;
  }

  const out: string[] = [];
  // Open anchors, innermost last. A link's label is buffered so that its URL
  // can be appended after it.
  const anchors: { href: string; start: number }[] = [];

  for (const token of tokenizeHtml(source)) {
    if (token.kind === 'text') {
      out.push(normalizeSpaces(decodeEntities(token.value)));
      continue;
    }

    const { name } = token;

    if (token.kind === 'open') {
      switch (name) {
        case 'a': {
          anchors.push({ href: token.attrs.href ?? '', start: out.length });
          break;
        }
        case 'br':
        case 'hr':
        case 'li':
        case 'tr': {
          out.push('\n');
          break;
        }
        default: {
          if (CELL.has(name)) out.push('\t');
          else if (BLOCK.has(name)) out.push('\n');
        }
      }
      continue;
    }

    switch (name) {
      case 'a': {
        const anchor = anchors.pop();
        if (anchor) {
          const label = out.splice(anchor.start).join('');
          out.push(renderLink(label, anchor.href, (text, url) => `${text} (${url})`));
        }
        break;
      }
      case 'li':
      case 'tr': {
        // A list item opens a line but does not close one — the next item's
        // start, or the list's end, does that. Counting both ends would put a
        // blank line between every pair of bullets, and it means a list written
        // without `</li>`, which is legal HTML, still comes out one per line.
        break;
      }
      default: {
        if (!CELL.has(name) && BLOCK.has(name)) out.push('\n');
      }
    }
  }

  return tidyText(out.join('')) || undefined;
}

/**
 * A link rendered by `format`, or just its URL when the label adds nothing —
 * it is empty, or it already is the address (producers often print a truncated
 * form of the same URL as the label).
 *
 * Whitespace just inside the anchor is whitespace between words on the page, so
 * it is put back around the result. `our<a> Software Engineer</a> position` is
 * common enough that dropping it would glue "our" to the job title.
 */
function renderLink(
  inner: string,
  href: string,
  format: (label: string, url: string) => string
): string {
  const url = href.trim();
  const lead = /^\s/.test(inner) ? ' ' : '';
  const trail = /\s$/.test(inner) ? ' ' : '';
  const label = inner.trim();

  if (!url) return `${lead}${label}${trail}`;
  const rendered = !label || label === url || url.startsWith(label) ? url : format(label, url);
  return `${lead}${rendered}${trail}`;
}

/**
 * Collapse the whitespace the markup left behind: runs of spaces within a line,
 * trailing spaces, and the stacks of blank lines that `<p><br></p>` produces.
 * At most one blank line survives, which is what the reader saw.
 */
function tidyText(text: string): string {
  return text
    .split('\n')
    .map(line => line.replaceAll(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// HTML → Markdown
// ---------------------------------------------------------------------------

/** The inline wrappers, and the delimiter each becomes. */
const EMPHASIS: { [tag: string]: string } = {
  strong: '**',
  b: '**',
  em: '*',
  i: '*',
  del: '~~',
  s: '~~',
  strike: '~~',
  code: '`',
};

interface ListFrame {
  ordered: boolean;
  /** The number the next `<li>` gets, for an ordered list. */
  index: number;
}

/**
 * The Markdown of a fragment that may or may not be HTML.
 *
 * A body with no markup comes back entity-decoded and **unescaped** — it is
 * already the text someone typed, and peppering it with backslashes would be
 * damage, not conversion. Only text that arrived inside real markup is escaped,
 * which is exactly the text that could otherwise be misread as Markdown.
 *
 * What survives the trip: headings, paragraphs, hard breaks, emphasis, inline
 * and fenced code, links, images, blockquotes, horizontal rules, and lists —
 * ordered ones keep counting, nested ones keep their depth.
 *
 * What does not: tables come out as tab-separated lines rather than as Markdown
 * tables, because a real table needs a column count known before the first row
 * is written and a linear pass does not have one.
 */
export function htmlToMarkdown(source = ''): string | undefined {
  if (!source.trim()) return undefined;
  if (!looksLikeHtml(source)) {
    return normalizeSpaces(decodeEntities(source)).trim() || undefined;
  }

  const out: string[] = [];
  const lists: ListFrame[] = [];
  const anchors: { href: string; start: number }[] = [];
  let quoteDepth = 0;
  let preDepth = 0;

  /** Start a new line, carrying the blockquote prefix onto it. */
  const newline = (count = 1) => {
    out.push('\n'.repeat(count));
    if (quoteDepth > 0) out.push('> '.repeat(quoteDepth));
  };

  for (const token of tokenizeHtml(source)) {
    if (token.kind === 'text') {
      const text = normalizeSpaces(decodeEntities(token.value));
      out.push(preDepth > 0 ? text : escapeMarkdown(text));
      continue;
    }

    const { name } = token;

    if (token.kind === 'open') {
      const { attrs } = token;

      switch (name) {
        case 'a': {
          anchors.push({ href: attrs.href ?? '', start: out.length });
          break;
        }
        case 'img': {
          const alt = escapeMarkdown(attrs.alt ?? '');
          if (attrs.src) out.push(`![${alt}](${attrs.src})`);
          break;
        }
        case 'br': {
          // Two trailing spaces are Markdown's hard break. A bare newline would
          // render as a space and silently lose the break the author put there.
          out.push('  ');
          newline();
          break;
        }
        case 'hr': {
          newline(2);
          out.push('---');
          newline(2);
          break;
        }
        case 'blockquote': {
          // Deepen first, so the break that opens the quote already carries the
          // new prefix. Prefixing after it would stack one depth on the other.
          quoteDepth++;
          newline(2);
          break;
        }
        case 'pre': {
          newline(2);
          preDepth++;
          out.push('```');
          newline();
          break;
        }
        case 'ul':
        case 'ol': {
          if (lists.length === 0) newline(2);
          lists.push({ ordered: name === 'ol', index: Number(attrs.start ?? 1) || 1 });
          break;
        }
        case 'li': {
          const frame = lists.at(-1);
          newline();
          out.push('  '.repeat(Math.max(0, lists.length - 1)));
          if (frame?.ordered) {
            out.push(`${frame.index}. `);
            frame.index++;
          } else {
            out.push('- ');
          }
          break;
        }
        case 'tr': {
          newline();
          break;
        }
        default: {
          if (EMPHASIS[name]) {
            // Inside a fence the delimiters are content, not markup:
            // `<pre><code>` would otherwise wrap the code in backticks inside
            // its own fence.
            if (preDepth === 0) out.push(EMPHASIS[name]);
          } else if (/^h[1-6]$/.test(name)) {
            newline(2);
            out.push(`${'#'.repeat(Number(name[1]))} `);
          } else if (CELL.has(name)) {
            out.push('\t');
          } else if (BLOCK.has(name)) {
            newline(2);
          }
        }
      }
      continue;
    }

    switch (name) {
      case 'a': {
        const anchor = anchors.pop();
        if (anchor) {
          const label = out.splice(anchor.start).join('');
          out.push(renderLink(label, anchor.href, (text, url) => `[${text}](${url})`));
        }
        break;
      }
      case 'pre': {
        preDepth = Math.max(0, preDepth - 1);
        newline();
        out.push('```');
        newline(2);
        break;
      }
      case 'blockquote': {
        quoteDepth = Math.max(0, quoteDepth - 1);
        newline(2);
        break;
      }
      case 'ul':
      case 'ol': {
        lists.pop();
        if (lists.length === 0) newline(2);
        break;
      }
      case 'li':
      case 'tr': {
        // The next item's start, or the list's end, does the breaking. Counting
        // both ends would put a blank line between every pair of bullets.
        break;
      }
      default: {
        if (EMPHASIS[name]) {
          if (preDepth === 0) out.push(EMPHASIS[name]);
        } else if (!CELL.has(name) && BLOCK.has(name)) {
          newline(2);
        }
      }
    }
  }

  return tidyMarkdown(out.join('')) || undefined;
}

/**
 * Escape the characters that would otherwise be read as Markdown.
 *
 * Deliberately narrow. `_` is escaped only where it could open emphasis — at a
 * word boundary — so `snake_case_names` survive unmangled, which is how
 * CommonMark reads them anyway. Line-leading `#`, `>`, `-`, `+` and `1.` are
 * escaped because there they would become a heading, a quote, or a list that
 * the author never wrote.
 */
function escapeMarkdown(text: string): string {
  return text
    .replaceAll(/([\\`*[\]])/g, String.raw`\$1`)
    .replaceAll(/(^|[\s(])_/g, String.raw`$1\_`)
    .replaceAll(/_($|[\s),.])/g, String.raw`\_$1`)
    .replaceAll(/^(\s*)([#>+-])/gm, String.raw`$1\$2`)
    .replaceAll(/^(\s*\d+)\./gm, String.raw`$1\.`);
}

/**
 * Tidy the generated Markdown without touching what it means: drop trailing
 * whitespace that is not a hard break, and collapse the runs of blank lines
 * that nested blocks leave behind.
 */
function tidyMarkdown(text: string): string {
  return (
    text
      .split('\n')
      .map(line => (line.endsWith('  ') ? `${line.trimEnd()}  ` : line.trimEnd()))
      .join('\n')
      .replaceAll(/\n{3,}/g, '\n\n')
      // A line that is nothing but quote markers is the break between two quoted
      // blocks, not a quoted empty line. Emptying it lets the collapse above run
      // again and close the gap.
      .replaceAll(/^(?:>\s*)+$/gm, '')
      .replaceAll(/\n{3,}/g, '\n\n')
      .trim()
  );
}
