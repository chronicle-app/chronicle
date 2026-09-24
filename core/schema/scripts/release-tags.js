// Reads release tags and the ontology each one shipped.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'core/schema';
const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: REPOSITORY, ...options });

/** Orders `a.b.c` versions, optionally with a leading `v`. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map(version => version.replace(/^v/, '').split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** Stable release tags, oldest first. */
export const releaseTags = list => list.filter(tag => RELEASE_TAG.test(tag)).sort(compareVersions);

export const listReleaseTags = () =>
  releaseTags(git(['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n'));

/** The ontology as of `tag`, or null when the tag has none. */
export function ontologyAt(tag) {
  try {
    return git(['show', `${tag}:${SCHEMA}/chronicle.ttl`], { stdio: 'pipe' });
  } catch {
    return null;
  }
}
