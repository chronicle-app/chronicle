import { execFileSync } from 'node:child_process';
import { resolveCredentials } from '@chronicle.app/auth';
import { AuthRequired } from '@chronicle.app/etl';

/** Where a token came from, in the order they're tried. */
export type CredentialSource = 'flag' | 'stored' | 'GH_TOKEN' | 'GITHUB_TOKEN' | 'gh';

export interface GitHubCredential {
  token: string;
  source: CredentialSource;
}

export interface ResolveGitHubCredentialOptions {
  /** The `--token` flag. */
  token?: string;
  /** Whether a token may be borrowed from the gh CLI (`--no-gh` turns it off). */
  gh: boolean;
  env?: NodeJS.ProcessEnv;
}

/** How each source reads in "Using GitHub credentials from …". */
export const CREDENTIAL_LABELS: Record<CredentialSource, string> = {
  flag: '--token',
  stored: 'chronicle auth',
  GH_TOKEN: 'GH_TOKEN',
  GITHUB_TOKEN: 'GITHUB_TOKEN',
  gh: 'gh CLI',
};

/**
 * The first token found: the `--token` flag, the token stored with
 * `chronicle auth set github`, `GH_TOKEN`, `GITHUB_TOKEN` (gh's own order for
 * the two), then `gh auth token`. A token borrowed from gh is only held in
 * memory, so refreshing or revoking it in gh takes effect on the next run.
 */
export async function resolveGitHubCredential(
  options: ResolveGitHubCredentialOptions
): Promise<GitHubCredential> {
  if (options.token) return { token: options.token, source: 'flag' };

  const { token: stored } = await resolveCredentials('github', {
    token: { from: ['accessToken'], optional: true },
  });
  if (stored) return { token: stored, source: 'stored' };

  const env = options.env ?? process.env;
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN'] as const) {
    const token = env[name]?.trim();
    if (token) return { token, source: name };
  }

  if (options.gh) {
    const token = ghToken();
    if (token) return { token, source: 'gh' };
  }

  throw new AuthRequired('No GitHub credentials found', {
    hint: options.gh
      ? 'run `gh auth login`, or `chronicle auth set github` with a personal access token'
      : 'run `chronicle auth set github` with a personal access token, or set GH_TOKEN',
  });
}

/** gh's token for github.com, or undefined when gh is missing or logged out. */
function ghToken(): string | undefined {
  try {
    const stdout = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
