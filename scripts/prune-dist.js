import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

// `tsc -b` never deletes what it built from a source that's since gone, and
// those files still load: oclif finds commands by scanning `dist`, and the
// plugin scanner finds extractors there. Run before a build, this removes each
// built file whose source no longer exists. Every package builds `src` into
// `dist`; anything else in `dist` (build info, data files) is left alone.
const OUTPUT = /(\.d\.[mc]?ts|\.[mc]?js)(\.map)?$/;
const SOURCES = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const files = directory =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]
  );

/** Remove directories left empty, deepest first; `dist` itself stays. */
function removeEmpty(directory, top = true) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmpty(join(directory, entry.name), false);
  }
  if (!top && readdirSync(directory).length === 0) rmSync(directory, { recursive: true });
}

const packages = ['core', 'plugins', 'apps']
  .filter(group => existsSync(group))
  .flatMap(group => readdirSync(group).map(name => join(group, name)))
  .filter(directory => existsSync(join(directory, 'src')) && existsSync(join(directory, 'dist')));

const removed = [];
for (const directory of packages) {
  const dist = join(directory, 'dist');
  for (const file of files(dist)) {
    const built = relative(dist, file);
    if (!OUTPUT.test(built)) continue;
    const base = join(directory, 'src', built.replace(OUTPUT, ''));
    if (SOURCES.some(extension => existsSync(base + extension))) continue;
    rmSync(file);
    removed.push(file);
  }
  removeEmpty(dist);
}
if (removed.length > 0) {
  process.stderr.write(`Removed ${removed.length} built files whose source is gone:\n`);
  for (const file of removed) process.stderr.write(`  ${file}\n`);
}
