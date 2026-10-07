import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import { ActionAndChildren, Agent, Entity, Person, ViewAction } from '@chronicle.app/schema';
import type { ChromeAccount } from './profile.js';

export default class ChromeTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'views') {
      actions.push(this.buildViewAction(record));
    }

    return actions;
  }

  private buildViewAction(record: Record): ViewAction {
    const user = this.buildUser(record.context.account);

    return {
      '@type': 'ViewAction',
      timestamp: new Date(record.data.unix_ms),
      '@key': ['@type', 'source', 'timestamp'],
      source: 'chrome',
      // A signed-out profile can't identify the viewer, so omit them.
      ...(user && { agent: user }),
      object: this.buildWebPage(record),
    };
  }

  /**
   * The profile's Google account, keyed on its Gaia id in the namespace other
   * Google sources share, with its email as a second identity: an `Agent` in
   * the `email` namespace, as every source keys an address.
   */
  private buildUser(account: ChromeAccount | null | undefined): Person | null {
    if (!account) return null;
    const sameAs: Agent[] = account.email
      ? [
          {
            '@type': 'Agent',
            '@key': ['@type', 'source', 'handle'],
            source: 'email',
            handle: account.email,
          },
        ]
      : [];
    return selfAgent({ source: 'google-account', sourceId: account.gaiaId, sameAs });
  }

  private buildWebPage(record: Record): Entity {
    return {
      '@type': 'Entity',
      '@key': ['url'],
      url: record.data.url,
      name: record.data.title || record.data.url,
    };
  }
}
