// When the site was built and from which commit, shown in the footer and
// published as build.json so anyone can tell whether the site is current.
import { execFileSync } from 'node:child_process';
import { SITE_DIRECTORY } from './directories.js';

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * The commit the site is built from: CHRONICLE_SITE_COMMIT, which deployments
 * set when they rebuild a release tag, then GITHUB_SHA in CI, then the
 * checkout's HEAD. Null when none of them names a commit.
 */
export function buildCommit(env = process.env, head = gitHead) {
  for (const candidate of [env.CHRONICLE_SITE_COMMIT, env.GITHUB_SHA]) {
    if (candidate) return COMMIT.test(candidate) ? candidate : null;
  }
  const commit = head();
  return commit && COMMIT.test(commit) ? commit : null;
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: SITE_DIRECTORY,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function buildInfo({ env = process.env, now = new Date(), head = gitHead } = {}) {
  return { time: now.toISOString(), commit: buildCommit(env, head) };
}

/** The Vite `define` entry that hands the build info to the pages. */
export const defineBuild = info => ({ __BUILD_INFO__: JSON.stringify(info) });
