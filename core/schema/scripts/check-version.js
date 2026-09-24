// The site serves main, so a vocabulary change on main must carry a new
// owl:versionInfo: otherwise the live /chronicle.ttl would differ from the
// released snapshot published under the same version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareVersions, listReleaseTags, ontologyAt } from './release-tags.js';
import { schemaVersion } from './schema-version.js';

/** Returns an error message, or null when `current` may be published. */
export function versionProblem(current, released) {
  if (released === null || current === released) return null;
  const [version, previous] = [schemaVersion(current), schemaVersion(released)];
  if (compareVersions(version, previous) > 0) return null;
  return `chronicle.ttl changed since the release of vocabulary ${previous}; raise owl:versionInfo above ${previous} (it is ${version}).`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tags = listReleaseTags();
  const tag = tags.findLast(candidate => ontologyAt(candidate) !== null);
  if (tag) {
    const current = readFileSync(new URL('../chronicle.ttl', import.meta.url), 'utf8');
    const problem = versionProblem(current, String(ontologyAt(tag)));
    assert.equal(problem, null, problem);
    console.log(`chronicle.ttl is publishable against ${tag}.`);
  } else {
    console.log('No release tags; skipped the vocabulary version check.');
  }
}
