// Assembles the site deployed to schema.chronicle.app. It is built from release
// tags rather than the working tree: the root serves the latest release, and
// releases/<version>/ keeps the first release of every vocabulary version.
// Each deployment replaces the whole site, so every snapshot is rebuilt from
// its tag and compared with what is already published.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaVersion } from '../scripts/schema-version.js';

export const DEPLOY_OUTPUT = fileURLToPath(new URL('../build/deploy/', import.meta.url));
export const PUBLISHED = 'https://schema.chronicle.app';
// Tags are extracted under build/ so their site code resolves this checkout's
// node_modules.
const CHECKOUTS = fileURLToPath(new URL('../build/tags/', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const SCHEMA = 'core/schema';
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const git = (args, options = {}) => execFileSync('git', args, { cwd: REPOSITORY, ...options });

const versionKey = tag => tag.slice(1).split('.').map(Number);

/** Stable release tags, oldest first. */
export function releaseTags(list) {
  return list
    .filter(tag => RELEASE_TAG.test(tag))
    .sort((a, b) => {
      const [x, y] = [versionKey(a), versionKey(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
}

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

function ontologyAt(tag) {
  try {
    return git(['show', `${tag}:${SCHEMA}/chronicle.ttl`], { stdio: 'pipe' });
  } catch {
    return null;
  }
}

/** Builds the site as of `tag` into `output`. Returns false for tags without one. */
async function buildTag(tag, output) {
  const checkout = join(CHECKOUTS, tag);
  await rm(checkout, { recursive: true, force: true });
  await mkdir(checkout, { recursive: true });
  execFileSync('tar', ['-x', '-C', checkout], {
    input: git(['archive', tag, SCHEMA], { maxBuffer: 1024 ** 3 }),
  });
  const builder = join(checkout, SCHEMA, 'site/build.js');
  if (!existsSync(builder)) return false;
  execFileSync(process.execPath, [builder, output], { stdio: 'inherit' });
  return true;
}

const pageNames = async directory =>
  (await readdir(directory))
    .filter(file => file.endsWith('.html') && file !== 'index.html')
    .map(file => file.slice(0, -'.html'.length));

export async function buildDeployment({ output = DEPLOY_OUTPUT, checkLive = true } = {}) {
  const tags = releaseTags(git(['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n'));
  if (tags.length === 0) throw new Error('There are no release tags to deploy.');
  const latest = tags.at(-1);

  await rm(output, { recursive: true, force: true });
  if (!(await buildTag(latest, output)))
    throw new Error(`The latest release, ${latest}, predates the documentation site.`);

  const ontologies = tags.map(tag => [tag, ontologyAt(tag)]);
  const releases = firstReleases(ontologies);
  for (const [version, tag] of releases) {
    const directory = join(output, 'releases', version);
    // Releases before the documentation site keep only the ontology.
    if (!(await buildTag(tag, directory))) await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'chronicle.ttl'), new Map(ontologies).get(tag));
  }

  const names = {
    classes: await pageNames(join(output, 'classes')),
    properties: await pageNames(join(output, 'properties')),
  };
  await writeFile(join(output, '_redirects'), redirects(names) + '\n');
  await writeFile(join(output, '_headers'), HEADERS);
  await rm(CHECKOUTS, { recursive: true, force: true });

  if (checkLive) await checkPublished(output, releases.keys());
  return { output, latest, releases };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { output, latest, releases } = await buildDeployment({
    checkLive: !process.argv.includes('--skip-published-check'),
  });
  console.log(`Built ${latest} into ${output} with releases ${[...releases.keys()].join(', ')}`);
}
