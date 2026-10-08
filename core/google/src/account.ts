import type { Agent } from '@chronicle.app/schema';

/**
 * A Google account by its Gaia id, in the `google-account` namespace every
 * Google source shares, so one account is one node whichever source names
 * it. A source links it to the person with `sameAs`.
 */
export function googleAccount(gaiaId: string): Agent {
  return {
    '@type': 'Agent',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'google-account',
    sourceId: gaiaId,
  };
}
