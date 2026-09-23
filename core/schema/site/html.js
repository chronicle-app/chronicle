// Small HTML helpers shared by the page renderers and the guide loader.

export const escape = value =>
  String(value ?? '').replaceAll(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );

export const paths = {
  class: name => `classes/${encodeURIComponent(name)}.html`,
  property: name => `properties/${encodeURIComponent(name)}.html`,
  example: id => `examples/${encodeURIComponent(id)}.html`,
  guide: slug => `guides/${encodeURIComponent(slug)}.html`,
};

// A term reference in prose: `:Name`, not preceded by a word character, slash,
// or colon, so times and URLs are left alone.
export const TERM = /(?<![\w/:]):[A-Za-z][A-Za-z0-9]*/g;

export function slugify(text) {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

export const firstSentence = text => {
  const flat = text.replaceAll(/\s+/g, ' ').trim();
  const match = flat.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : flat;
};
