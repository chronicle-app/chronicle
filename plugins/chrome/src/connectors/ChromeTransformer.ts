import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import { googleAccount } from '@chronicle.app/google';
import {
  ActionAndChildren,
  Agent,
  Entity,
  NavigateAction,
  ViewAction,
} from '@chronicle.app/schema';
import type { ChromeNavigation } from './ChromeExtractor.js';
import type { ChromeAccount } from './profile.js';

export default class ChromeTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'views') {
      const user = this.buildUser(record.context.account);
      actions.push(this.buildViewAction(record, user));
      const navigation = record.data.navigation as ChromeNavigation | null;
      if (navigation) actions.push(this.buildNavigateAction(record, navigation, user));
    }

    return actions;
  }

  private buildViewAction(record: Record, user: Agent | null): ViewAction {
    return {
      '@type': 'ViewAction',
      timestamp: new Date(record.data.unix_ms),
      // Chrome's visit id is only unique within one History file, but a
      // synced visit keeps its time, so the page and time are the visit on
      // every device. Two pages can open in the same millisecond.
      '@key': ['@type', 'source', 'object.url', 'timestamp'],
      source: 'chrome',
      // A profile never signed in can't identify the viewer, so omit them.
      ...(user && { agent: user }),
      object: this.buildWebPage(record),
    };
  }

  /**
   * The step from the page you followed a link or submitted a form on to the
   * page you landed on, at the same moment as the visit. Both pages are the
   * bare URL nodes the visits name. A followed link is also evidence that its
   * page links to the URL followed, before any redirects, so that page
   * `references` it. A form's address is not a link on the page.
   */
  private buildNavigateAction(
    record: Record,
    navigation: ChromeNavigation,
    user: Agent | null
  ): NavigateAction {
    const followed = this.pageByUrl(navigation.followed_url);
    return {
      '@type': 'NavigateAction',
      timestamp: new Date(record.data.unix_ms),
      // Keyed as the visit is: the page landed on, and when.
      '@key': ['@type', 'source', 'target.url', 'timestamp'],
      source: 'chrome',
      ...(user && { agent: user }),
      object: {
        ...this.pageByUrl(navigation.from_url),
        ...(!navigation.form_submit && { references: [followed] }),
      },
      target: this.pageByUrl(record.data.url),
    };
  }

  /**
   * The profile's Google account as you: its address, as Gmail and Google
   * Calendar key you, `sameAs` the account, keyed by the same address in the
   * `google-account` namespace they link you to.
   */
  private buildUser(account: ChromeAccount | null | undefined): Agent | null {
    if (!account) return null;
    return selfAgent({
      type: 'Agent',
      source: 'email',
      handle: account.email,
      ...(account.name && { name: account.name }),
      sameAs: [googleAccount(account.email)],
    });
  }

  private buildWebPage(record: Record): Entity {
    return {
      ...this.pageByUrl(record.data.url),
      name: record.data.title || record.data.url,
    };
  }

  private pageByUrl(url: string): Entity {
    return { '@type': 'Entity', '@key': ['url'], url };
  }
}
