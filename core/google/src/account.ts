import type { Agent } from '@chronicle.app/schema';

/**
 * A Google account by its address, in the `google-account` namespace, so
 * Gmail, Google Calendar, and Chrome name the same account the same way. An
 * address is the one identifier every way in has: an API, a Takeout, or a
 * browser profile. The source's node for you is `sameAs` it.
 */
export function googleAccount(address: string): Agent {
  return {
    '@type': 'Agent',
    '@key': ['@type', 'source', 'handle'],
    source: 'google-account',
    handle: address.toLowerCase(),
  };
}
