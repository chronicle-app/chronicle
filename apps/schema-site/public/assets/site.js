/* global window, document, navigator, location, localStorage, CSS */
const root = document.documentElement.dataset.root || '';
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
for (const label of document.querySelectorAll('[data-shortcut]')) {
  label.textContent = isMac ? '⌘K' : 'Ctrl K';
}

// ------------------------------------------------------------------ theme

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {}
}
document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
  const current =
    document.documentElement.dataset.theme ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// ------------------------------------------------------------------- menu

const menu = document.querySelector('[data-menu]');
menu?.addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  menu.setAttribute('aria-expanded', String(open));
});
document.querySelector('.sidebar [aria-current]')?.scrollIntoView({ block: 'center' });

// ----------------------------------------------------------------- search

const entries = window.SCHEMA_SEARCH || [];
const dialog = document.querySelector('#search-dialog');
const input = document.querySelector('#search');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
const kindLabels = {
  guide: 'Guide',
  class: 'Class',
  property: 'Property',
  example: 'Example',
  home: 'Page',
  guides: 'Page',
  classes: 'Page',
  properties: 'Page',
  examples: 'Page',
  validator: 'Page',
};
const kindOrder = ['class', 'property', 'guide', 'example'];
let matches = [];
let active = -1;
let returnFocus = null;

function score(entry, query, terms) {
  const title = entry.title.toLowerCase();
  const rank =
    title === query
      ? 0
      : title.startsWith(query)
        ? 1
        : terms.every(term => title.includes(term))
          ? 2
          : terms.every(term => entry.description.toLowerCase().includes(term))
            ? 3
            : 4;
  const kind = kindOrder.indexOf(entry.kind);
  return rank * 10 + (kind < 0 ? 9 : kind);
}

function select(index) {
  active = matches.length > 0 ? (index + matches.length) % matches.length : -1;
  for (const [i, option] of [...results.children].entries())
    option.setAttribute('aria-selected', String(i === active));
  if (active < 0) input.removeAttribute('aria-activedescendant');
  else {
    input.setAttribute('aria-activedescendant', results.children[active].id);
    results.children[active].scrollIntoView({ block: 'nearest' });
  }
}

function update() {
  const query = input.value.trim().toLowerCase().replace(/^:/, '');
  const terms = query.split(/\s+/).filter(Boolean);
  const found = query
    ? entries
        .filter(entry => {
          const text = `${entry.title} ${entry.description} ${entry.keywords}`.toLowerCase();
          return terms.every(term => text.includes(term));
        })
        .sort(
          (a, b) =>
            score(a, query, terms) - score(b, query, terms) || a.title.localeCompare(b.title)
        )
    : entries.filter(entry => entry.kind === 'guide' || entry.kind === 'classes');
  matches = found.slice(0, 40);
  results.replaceChildren(
    ...matches.map((entry, index) => {
      const option = document.createElement('li');
      option.id = `search-result-${index}`;
      option.setAttribute('role', 'option');
      const link = document.createElement('a');
      link.href = root + entry.path;
      link.tabIndex = -1;
      const kind = document.createElement('span');
      kind.className = `result-kind kind-${entry.kind}`;
      kind.textContent = kindLabels[entry.kind] || entry.kind;
      const title = document.createElement('strong');
      title.textContent = entry.title;
      const description = document.createElement('small');
      description.textContent = entry.description;
      link.append(kind, title, description);
      option.append(link);
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('mousemove', () => active !== index && select(index));
      return option;
    })
  );
  status.textContent = query
    ? found.length > 0
      ? `${found.length} result${found.length === 1 ? '' : 's'}`
      : `No results for “${input.value.trim()}”.`
    : 'Type to search every guide, class, property, and example.';
  input.setAttribute('aria-expanded', String(matches.length > 0));
  select(0);
}

function openSearch() {
  if (!dialog.open) {
    returnFocus = document.activeElement;
    dialog.showModal();
  }
  update();
  input.focus();
  input.select();
}

for (const button of document.querySelectorAll('[data-open-search]'))
  button.addEventListener('click', openSearch);
dialog.addEventListener('close', () => {
  input.setAttribute('aria-expanded', 'false');
  if (returnFocus?.isConnected) returnFocus.focus();
});
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});
input.addEventListener('input', update);
input.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    select(active + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter' && active >= 0) {
    event.preventDefault();
    location.assign(root + matches[active].path);
  }
});
document.addEventListener('keydown', event => {
  if (event.isComposing || event.repeat) return;
  const commandK =
    (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
  const editable = event.target.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  );
  const slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !editable;
  if (commandK || slash) {
    event.preventDefault();
    if (commandK && dialog.open) dialog.close();
    else openSearch();
  }
});

// --------------------------------------------------------------- payloads

function showFormat(payload, format, focus = false) {
  for (const tab of payload.querySelectorAll('[role="tab"]')) {
    const selected = tab.dataset.format === format;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const panel of payload.querySelectorAll('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== format;
  }
}

document.addEventListener('click', async event => {
  const tab = event.target.closest('[data-payload] [role="tab"]');
  if (tab) {
    const { format } = tab.dataset;
    // Keep every example on the page in the same format.
    for (const payload of document.querySelectorAll('[data-payload]')) showFormat(payload, format);
    try {
      localStorage.setItem('payload-format', format);
    } catch {}
    return;
  }
  const copy = event.target.closest('[data-copy]');
  if (!copy) return;
  const code = copy.closest('[data-payload]').querySelector('[data-panel]:not([hidden]) code');
  const label = copy.querySelector('span');
  try {
    await navigator.clipboard.writeText(code.textContent);
    label.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    label.textContent = 'Selected';
  }
  copy.classList.add('done');
  setTimeout(() => {
    label.textContent = 'Copy';
    copy.classList.remove('done');
  }, 1600);
});

document.addEventListener('keydown', event => {
  const tab = event.target.closest?.('[data-payload] [role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs = [...tab.parentElement.children];
  const next =
    tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  showFormat(tab.closest('[data-payload]'), next.dataset.format, true);
});

try {
  const format = localStorage.getItem('payload-format');
  if (format) for (const p of document.querySelectorAll('[data-payload]')) showFormat(p, format);
} catch {}

// ------------------------------------------------------ table of contents

const tocLinks = [...document.querySelectorAll('.toc a')];
if (tocLinks.length > 0 && 'IntersectionObserver' in window) {
  const sections = tocLinks
    .map(link =>
      document.querySelector(`[id="${CSS.escape(decodeURIComponent(link.hash.slice(1)))}"]`)
    )
    .filter(Boolean);
  const observer = new window.IntersectionObserver(
    () => {
      const current =
        sections.filter(section => section.getBoundingClientRect().top < 140).at(-1) || sections[0];
      for (const link of tocLinks)
        link.classList.toggle('active', link.hash.slice(1) === current?.id);
    },
    { rootMargin: '0px 0px -60% 0px', threshold: [0, 1] }
  );
  for (const section of sections) observer.observe(section);
}
