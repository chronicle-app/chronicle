import { readFileSync } from 'node:fs';
import { Locator, type Candidate, type LocationMatch } from '@chronicle.app/etl';
import { CREDENTIAL_LABELS, resolveGitHubCredential } from '../utils/credentials.js';

/**
 * The account gh is signed in to on github.com, from its `hosts.yml`, which
 * keeps the login beside the token's whereabouts but not the token.
 */
function ghUser(hostsPath: string): string | undefined {
  let hosts: string;
  try {
    hosts = readFileSync(hostsPath, 'utf8');
  } catch {
    return undefined;
  }
  const block = hosts.match(/^github\.com:\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
  return block.match(/^[ \t]+user:[ \t]*(\S+)/m)?.[1];
}

/**
 * The credential a run would use, found the way the run finds it: a stored
 * token, `GH_TOKEN`, `GITHUB_TOKEN`, then gh's. Says where it came from,
 * never what it is, and doesn't ask GitHub whether it still works.
 */
export class GitHubLocator extends Locator {
  static override source = 'github';
  static override strategy = 'api';

  override async *locate(matches: LocationMatch[]): AsyncGenerator<Candidate> {
    const hosts = matches[0]?.path;
    try {
      const { source } = await resolveGitHubCredential({ gh: true, env: this.context.env });
      const user = source === 'gh' && hosts ? ghUser(hosts) : undefined;
      const label = CREDENTIAL_LABELS[source];
      yield {
        label: user ? `${label} (${user})` : label,
        config: {},
        status: 'ready',
        credential: source,
      };
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth-required') throw error;
      // gh is set up but signed out: a sign-in away. Without gh, nothing says GitHub is used here.
      if (!hosts) return;
      yield {
        label: `${CREDENTIAL_LABELS.gh}, signed out`,
        config: {},
        status: 'signed-out',
        remedy: (error as { hint?: string }).hint,
      };
    }
  }
}
