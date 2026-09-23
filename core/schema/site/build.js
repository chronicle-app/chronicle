import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGuides } from './guides.js';
import { firstSentence, TERM } from './html.js';
import { loadSchema, ONTOLOGY_FILE } from './model.js';
import { renderSite } from './render.js';

export const DEFAULT_OUTPUT = fileURLToPath(new URL('../build/site/', import.meta.url));
const ASSETS = new URL('assets/', import.meta.url);
const plain = text => text.replaceAll(TERM, match => match.slice(1)).replaceAll(/\s+/g, ' ');

/** Builds the documentation site into `output`, replacing what was there. */
export async function buildSite(output = DEFAULT_OUTPUT) {
  const schema = await loadSchema();
  const guides = await loadGuides(schema);
  const pages = renderSite(schema, guides);

  await rm(output, { recursive: true, force: true });
  for (const page of pages) {
    const file = join(output, page.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, page.document);
  }

  await mkdir(join(output, 'assets'), { recursive: true });
  for (const asset of await readdir(ASSETS)) {
    await copyFile(new URL(asset, ASSETS), join(output, 'assets', asset));
  }
  const index = pages.map(page => ({
    title: page.title,
    kind: page.kind,
    path: page.path,
    description: plain(firstSentence(page.description ?? '')),
    keywords: plain(`${page.description ?? ''} ${page.search ?? ''}`),
  }));
  await writeFile(
    join(output, 'assets', 'search-index.js'),
    `window.SCHEMA_SEARCH = ${JSON.stringify(index).replaceAll('<', '\\u003c')};\n`
  );
  await copyFile(ONTOLOGY_FILE, join(output, 'chronicle.ttl'));
  return { output, pages };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { output, pages } = await buildSite(process.argv[2] && resolve(process.argv[2]));
  console.log(`Built ${pages.length} pages into ${output}`);
}
