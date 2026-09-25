// Assembles the site deployed to schema.chronicle.app. The root is the working
// tree, which in CI is main: main holds only vocabulary that is meant to be
// published. releases/<version>/ keeps the first release of every vocabulary
// version, rebuilt from its tag, since each deployment replaces the whole site.
// Rebuilt snapshots are compared with what is already published.
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  git,
  listReleaseTags,
  ontologyAt,
  SCHEMA,
} from '../../../core/schema/scripts/release-tags.js';
import { schemaVersion } from '../../../core/schema/scripts/schema-version.js';
import { buildSite } from './build.js';

export const DEPLOY_OUTPUT = fileURLToPath(new URL('../build/deploy/', import.meta.url));
export const PUBLISHED = 'https://schema.chronicle.app';
// Tags are extracted under build/ so their site code resolves this checkout's
// node_modules.
const CHECKOUTS = fileURLToPath(new URL('../build/tags/', import.meta.url));
export const SITE = 'apps/schema-site';
const BUILDER = `${SITE}/scripts/build.js`;

/**
 * Maps each vocabulary version to the first release that shipped it, from
 * [tag, ontology] pairs in release order. Tags without an ontology are skipped.
 */
export function firstReleases(ontologies) {
  const releases = new Map();
  for (const [tag, ontology] of ontologies) {
    if (ontology === null) continue;
    const version = schemaVersion(String(ontology));
    if (!releases.has(version)) releases.set(version, tag);
  }
  return releases;
}

/** Term IRIs such as /Task redirect to their pages. */
export function redirects({ classes, properties }) {
  return [
    ...classes.map(name => `/${name} /classes/${name} 303`),
    ...properties.map(name => `/${name} /properties/${name} 303`),
  ].join('\n');
}

export const HEADERS = `/*
  Access-Control-Allow-Origin: *
`;

/** Fails when a snapshot differs from the published copy at the same path. */
export async function checkPublished(output, versions, base = PUBLISHED) {
  for (const version of versions) {
    const path = `releases/${version}/chronicle.ttl`;
    const response = await fetch(`${base}/${path}`);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Could not read ${base}/${path}: HTTP ${response.status}`);
    const published = Buffer.from(await response.arrayBuffer());
    if (!published.equals(await readFile(join(output, path))))
      throw new Error(`${path} differs from the published snapshot, which must not change.`);
  }
}

/**
 * Builds the site as of `tag` into `output`, served from `base`. Returns false
 * for tags without one.
 */
async function buildTag(tag, output, base) {
  try {
    git(['cat-file', '-e', `${tag}:${BUILDER}`], { stdio: 'pipe' });
  } catch {
    return false;
  }
  const checkout = join(CHECKOUTS, tag);
  await rm(checkout, { recursive: true, force: true });
  await mkdir(checkout, { recursive: true });
  // The site reads the vocabulary by path, so both keep their repository layout.
  execFileSync('tar', ['-x', '-C', checkout], {
    input: git(['archive', tag, SCHEMA, SITE], { maxBuffer: 1024 ** 3 }),
  });
  execFileSync(process.execPath, [join(checkout, BUILDER), output, base], { stdio: 'inherit' });
  return true;
}

const pageNames = async directory =>
  (await readdir(directory))
    .filter(file => file.endsWith('.html') && file !== 'index.html')
    .map(file => file.slice(0, -'.html'.length));

export async function buildDeployment({ output = DEPLOY_OUTPUT, checkLive = true } = {}) {
  await buildSite({ output });

  const ontologies = listReleaseTags().map(tag => [tag, ontologyAt(tag)]);
  const releases = firstReleases(ontologies);
  for (const [version, tag] of releases) {
    const directory = join(output, 'releases', version);
    // Releases before the documentation site keep only the ontology.
    if (!(await buildTag(tag, directory, `/releases/${version}/`)))
      await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'chronicle.ttl'), new Map(ontologies).get(tag));
  }
  await rm(CHECKOUTS, { recursive: true, force: true });

  const names = {
    classes: await pageNames(join(output, 'classes')),
    properties: await pageNames(join(output, 'properties')),
  };
  await writeFile(join(output, '_redirects'), redirects(names) + '\n');
  await writeFile(join(output, '_headers'), HEADERS);

  if (checkLive) await checkPublished(output, releases.keys());
  return { output, releases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { output, releases } = await buildDeployment({
    checkLive: !process.argv.includes('--skip-published-check'),
  });
  console.log(`Built the site into ${output} with releases ${[...releases.keys()].join(', ')}`);
}
