import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

// The README's sources section, generated from catalog.json and each plugin's
// `chronicle` manifest. Run directly to rewrite it.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const START = '<!-- sources:start -->';
const END = '<!-- sources:end -->';

function rows(entries) {
  const lines = ['| Source | Package | Strategies |', '| --- | --- | --- |'];
  for (const entry of entries) {
    const { chronicle } = JSON.parse(read(`plugins/${entry.name}/package.json`));
    const strategies = Object.values(chronicle.sources)
      .flatMap(source => Object.entries(source.strategies))
      // The default strategy first; it's what a bare `chronicle extract` takes.
      .sort(([, a], [, b]) => Number(Boolean(b.default)) - Number(Boolean(a.default)))
      .map(([name, strategy]) =>
        name === strategy.delivery ? name : `${name} (${strategy.delivery})`
      )
      .join(', ');
    lines.push(
      `| ${entry.summary} | [${entry.name}](plugins/${entry.name}/README.md) | ${strategies} |`
    );
  }
  return lines.join('\n');
}

/** The README with its sources section regenerated. */
export async function renderReadme() {
  const { plugins } = JSON.parse(read('catalog.json'));
  const order = { core: 0, official: 1, listed: 2 };
  const current = plugins
    .filter(entry => entry.tier !== 'legacy' && entry.tier !== 'listed')
    .sort((a, b) => order[a.tier] - order[b.tier]);
  const legacy = plugins.filter(entry => entry.tier === 'legacy');
  const section = [
    START,
    '<!-- Generated from catalog.json and plugin manifests: npm run readme:sources -->',
    rows(current),
    'For services that no longer exist, shown by `chronicle sources --all`:',
    rows(legacy),
    END,
  ].join('\n\n');
  const readme = read('README.md');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < 0) throw new Error(`README.md is missing ${START} or ${END}`);
  const updated = readme.slice(0, start) + section + readme.slice(end + END.length);
  const options = await prettier.resolveConfig(fileURLToPath(new URL('README.md', root)));
  return prettier.format(updated, { ...options, parser: 'markdown' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('README.md', root), await renderReadme());
}
