import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  Entity,
  Person,
  SoftwareApplication,
  ViewAction,
} from '@chronicle.app/schema';
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
    const install = this.buildInstall(record.data.device_guid);

    return {
      '@type': 'ViewAction',
      timestamp: new Date(record.data.unix_ms),
      '@key': ['@type', 'source', 'timestamp'],
      source: 'chrome',
      // A signed-out profile can't identify the viewer, so omit them.
      ...(user && { agent: user }),
      ...(install && { instrument: install }),
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

  /**
   * The Chrome install that recorded the visit: a profile's sync client, keyed
   * on its id. It names the install, not the hardware, so the same visit synced
   * to several machines names the same install on each.
   */
  private buildInstall(guid: string | null): SoftwareApplication | null {
    if (!guid) return null;
    return {
      '@type': 'SoftwareApplication',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'chrome',
      sourceId: guid,
      name: 'Chrome',
    };
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
