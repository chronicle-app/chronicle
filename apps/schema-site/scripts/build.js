// Builds the site with Astro. Deployments also run this file from each release
// tag, as `node scripts/build.js <output> <base>`, to rebuild that release's
// snapshot, so keep its arguments stable.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import { buildInfo, defineBuild } from './build-info.js';
import { DATA_DIRECTORIES, defineDirectories, SITE_DIRECTORY } from './directories.js';

export const DEFAULT_OUTPUT = fileURLToPath(new URL('../build/site/', import.meta.url));

/**
 * Builds the site into `output`, replacing what was there. `base` is the path
 * it is served from; `directories` replaces the schema or guides directory, and
 * `info` the build time and commit shown on every page.
 */
export async function buildSite({
  output = DEFAULT_OUTPUT,
  base = '/',
  directories = {},
  info = buildInfo(),
} = {}) {
  process.env.ASTRO_TELEMETRY_DISABLED ??= '1';
  await build({
    root: SITE_DIRECTORY,
    outDir: output,
    base,
    logLevel: 'warn',
    vite: {
      define: {
        ...defineDirectories({ ...DATA_DIRECTORIES, ...directories }),
        ...defineBuild(info),
      },
    },
  });
  return { output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, base] = process.argv.slice(2);
  const result = await buildSite({ output: output && resolve(output), base });
  console.log(`Built the site into ${result.output}`);
}
