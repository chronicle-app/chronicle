// Syntax-highlighted code with term links. These build HTML strings on
// purpose: inside <pre>, every space and newline is output, so the markup is
// assembled here and rendered with set:html rather than as nested components.
import { classes, escape, href, properties } from './site.js';

export function jsonHtml(value, indent = 0, key = null) {
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
      const label =
        !name.startsWith('@') && properties.has(name)
          ? `"<a class="code-link" href="${href.property(name)}">${escape(name)}</a>"`
          : `"${escape(name)}"`;
      return `${pad}  <span class="json-key">${label}</span>: ${jsonHtml(item, indent + 1, name)}`;
    });
    return `{\n${entries.join(',\n')}\n${pad}}`;
  }
  if (typeof value === 'string') {
    if (key === '@type' && classes.has(value)) {
      return `<span class="json-string">"<a class="code-link" href="${href.class(value)}">${escape(value)}</a>"</span>`;
    }
    return `<span class="json-string">${escape(JSON.stringify(value))}</span>`;
  }
  return `<span class="json-literal">${escape(JSON.stringify(value))}</span>`;
}

export function turtleHtml(text) {
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
        ? href.class(name)
        : properties.has(name)
          ? href.property(name)
          : null;
      html += target ? `<a class="code-link" href="${target}">${escape(token)}</a>` : escape(token);
    }
    cursor = match.index + token.length;
  }
  return html + escape(text.slice(cursor));
}
