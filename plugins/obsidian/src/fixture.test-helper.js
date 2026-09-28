import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ObsidianExtractor, ObsidianTransformer } from '../dist/index.js';

/** A fixed mtime; seconds after 2023-11-14T22:13:20Z. */
export const at = seconds => new Date(1_700_000_000_000 + seconds * 1000);

/**
 * Writes a synthetic vault into a temp dir. Each file is `name: body` or
 * `name: [body, mtimeSeconds]`. Returns the vault directory.
 */
export function vault(t, files, { name = 'Notebook', obsidian = true } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'obsidian-fixture-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, name);
  mkdirSync(root);
  if (obsidian) {
    mkdirSync(join(root, '.obsidian'));
    writeFileSync(join(root, '.obsidian', 'app.json'), '{}');
  }
  for (const [file, value] of Object.entries(files)) {
    const [body, seconds] = Array.isArray(value) ? value : [value, 0];
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    utimesSync(full, at(seconds), at(seconds));
  }
  return root;
}

export async function extract(input, limit = 0) {
  const extractor = new ObsidianExtractor({ input, limit, quiet: true });
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    return { extractor, records, count: await extractor.determineCount() };
  } finally {
    await extractor.teardown();
  }
}

export async function transform(records) {
  const transformer = new ObsidianTransformer({ quiet: true });
  const nodes = await Promise.all(records.map(record => transformer.performTransform(record)));
  return nodes.flat().map(node => node.data);
}
